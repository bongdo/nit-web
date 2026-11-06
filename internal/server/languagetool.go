package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	defaultGrammarPort    = "8179"
	grammarDisabledRules  = "UPPERCASE_SENTENCE_START,I_LOWERCASE,MORFOLOGIK_RULE_RU_RU,MORFOLOGIK_RULE_EN_US,WHITESPACE_RULE"
	maxGrammarText        = 8000
	maxGrammarMatches     = 20
	grammarStartupTimeout = 30 * time.Second
)

type grammarMatch struct {
	Offset       int      `json:"offset"`
	Length       int      `json:"length"`
	Message      string   `json:"message"`
	RuleID       string   `json:"ruleID"`
	Replacements []string `json:"replacements"`
}

type grammarChecker struct {
	log      *slog.Logger
	client   *http.Client
	url      string
	external bool
	port     string

	mu   sync.Mutex
	cmd  *exec.Cmd
	done chan struct{}
}

func newGrammarChecker(log *slog.Logger) *grammarChecker {
	external := strings.TrimSpace(os.Getenv("NIT_GUI_LANGUAGETOOL_URL"))
	port := strings.TrimSpace(os.Getenv("NIT_GUI_LANGUAGETOOL_PORT"))
	if port == "" {
		port = defaultGrammarPort
	}
	base := external
	if base == "" {
		base = "http://127.0.0.1:" + port
	}
	return &grammarChecker{
		log:      log,
		client:   &http.Client{Timeout: 20 * time.Second},
		url:      strings.TrimRight(base, "/"),
		external: external != "",
		port:     port,
	}
}

func (g *grammarChecker) running() bool {
	if g.cmd == nil {
		return false
	}
	select {
	case <-g.done:
		return false
	default:
		return true
	}
}

func (g *grammarChecker) ensure(ctx context.Context) error {
	if g.external {
		return g.health(ctx)
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.running() {
		return nil
	}
	g.cmd = nil
	g.done = nil
	bin := strings.TrimSpace(os.Getenv("NIT_GUI_LANGUAGETOOL"))
	if bin == "" {
		var err error
		bin, err = exec.LookPath("languagetool-http-server")
		if err != nil {
			return fmt.Errorf("languagetool-http-server not found; set NIT_GUI_LANGUAGETOOL")
		}
	}
	javaOptions := strings.TrimSpace(os.Getenv("NIT_GUI_LANGUAGETOOL_JAVA_OPTS"))
	if javaOptions == "" {
		javaOptions = "-Xms256m -Xmx512m"
	}
	cmd := exec.Command(bin, "--port", g.port)
	cmd.Env = withEnv("JAVA_TOOL_OPTIONS", javaOptions)
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan struct{})
	g.cmd = cmd
	g.done = done
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	deadline := time.Now().Add(grammarStartupTimeout)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			g.stop()
			return ctx.Err()
		}
		if !g.running() {
			return fmt.Errorf("languagetool exited during startup")
		}
		if g.health(ctx) == nil {
			g.log.Info("languagetool started", "url", g.url)
			if os.Getenv("NIT_GUI_LANGUAGETOOL_PREWARM") != "0" {
				go g.prewarm()
			}
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	g.stop()
	return fmt.Errorf("languagetool did not start")
}

func (g *grammarChecker) stop() {
	if g.cmd == nil {
		return
	}
	_ = g.cmd.Process.Kill()
	g.cmd = nil
	g.done = nil
}

func (g *grammarChecker) health(ctx context.Context) error {
	checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(checkCtx, http.MethodGet, g.url+"/v2/languages", nil)
	if err != nil {
		return err
	}
	response, err := g.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
	if response.StatusCode >= 400 {
		return fmt.Errorf("languagetool returned %d", response.StatusCode)
	}
	return nil
}

func (g *grammarChecker) available(ctx context.Context) (bool, string) {
	if g.external {
		if g.health(ctx) == nil {
			return true, "LanguageTool (external)"
		}
		return false, "LanguageTool is not reachable"
	}
	if g.running() {
		if g.health(ctx) == nil {
			return true, "LanguageTool"
		}
		return false, "LanguageTool is not responding"
	}
	if bin := strings.TrimSpace(os.Getenv("NIT_GUI_LANGUAGETOOL")); bin == "" {
		if _, err := exec.LookPath("languagetool-http-server"); err != nil {
			return false, "not installed on the nit-gui host"
		}
	}
	return true, "LanguageTool · starts on first use"
}

func (g *grammarChecker) prewarm() {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	_, _ = g.request(ctx, "тест", "ru-RU")
	_, _ = g.request(ctx, "test", "en-US")
}

func (g *grammarChecker) check(ctx context.Context, text string) ([]grammarMatch, error) {
	if utf8.RuneCountInString(text) > maxGrammarText {
		return nil, fmt.Errorf("text is too long")
	}
	language, ok := grammarLanguage(text)
	if !ok {
		return nil, nil
	}
	if err := g.ensure(ctx); err != nil {
		return nil, err
	}
	return g.request(ctx, text, language)
}

type languageToolMatch struct {
	Offset  int    `json:"offset"`
	Length  int    `json:"length"`
	Message string `json:"message"`
	Rule    struct {
		ID string `json:"id"`
	} `json:"rule"`
	Replacements []struct {
		Value string `json:"value"`
	} `json:"replacements"`
}

func (g *grammarChecker) request(ctx context.Context, text, language string) ([]grammarMatch, error) {
	form := url.Values{
		"text":               {text},
		"language":           {language},
		"disabledRules":      {grammarDisabledRules},
		"maxCheckTimeMillis": {"5000"},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, g.url+"/v2/check",
		strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := g.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("languagetool returned %d", response.StatusCode)
	}
	var out struct {
		Matches []languageToolMatch `json:"matches"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return filterGrammarMatches(out.Matches), nil
}

func filterGrammarMatches(input []languageToolMatch) []grammarMatch {
	result := make([]grammarMatch, 0, len(input))
	for _, match := range input {
		if match.Offset < 0 || match.Length <= 0 {
			continue
		}
		if match.Rule.ID == "UPPERCASE_SENTENCE_START" || match.Rule.ID == "I_LOWERCASE" ||
			match.Rule.ID == "WHITESPACE_RULE" || strings.HasPrefix(match.Rule.ID, "MORFOLOGIK_RULE") {
			continue
		}
		seen := make(map[string]struct{}, len(match.Replacements))
		replacements := make([]string, 0, len(match.Replacements))
		for _, replacement := range match.Replacements {
			value := strings.TrimSpace(replacement.Value)
			if value == "" {
				continue
			}
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
			replacements = append(replacements, value)
			if len(replacements) == 5 {
				break
			}
		}
		if len(replacements) == 0 {
			continue
		}
		result = append(result, grammarMatch{
			Offset:       match.Offset,
			Length:       match.Length,
			Message:      match.Message,
			RuleID:       match.Rule.ID,
			Replacements: replacements,
		})
	}
	sort.SliceStable(result, func(left, right int) bool {
		return result[left].Offset < result[right].Offset
	})
	if len(result) > maxGrammarMatches {
		result = result[:maxGrammarMatches]
	}
	return result
}

func grammarLanguage(text string) (string, bool) {
	var cyrillic, latin int
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Cyrillic, r):
			cyrillic++
		case unicode.Is(unicode.Latin, r):
			latin++
		}
	}
	if cyrillic == 0 && latin == 0 {
		return "", false
	}
	if cyrillic > latin {
		return "ru-RU", true
	}
	return "en-US", true
}

func withEnv(key, value string) []string {
	prefix := key + "="
	env := os.Environ()
	result := make([]string, 0, len(env)+1)
	for _, item := range env {
		if !strings.HasPrefix(item, prefix) {
			result = append(result, item)
		}
	}
	return append(result, prefix+value)
}
