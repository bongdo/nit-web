package gate

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"nitgui/internal/gateid"
)

func testAgents(t *testing.T) *Agents {
	t.Helper()
	agents, err := OpenAgents(filepath.Join(t.TempDir(), "agents.json"))
	if err != nil {
		t.Fatal(err)
	}
	return agents
}

func testAgentServer(t *testing.T, agents *Agents) *httptest.Server {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(upstream.Close)
	server := httptest.NewServer(New(testRoutes(t, upstream.URL), testStore(t), agents, []byte(testKey), nil).Handler())
	t.Cleanup(server.Close)
	return server
}

func agentIdentity() (string, string) {
	id := gateid.Identity{
		User: "nit-gui",
		Role: gateid.RoleAdmin,
		Caps: gateid.Caps(gateid.RoleAdmin),
		Exp:  time.Now().Add(time.Minute).Unix(),
	}
	return gateid.Header, gateid.Sign([]byte(testKey), id)
}

func TestAgentTokens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agents.json")
	agents, err := OpenAgents(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agents.Add("bad name"); !errors.Is(err, ErrBadName) {
		t.Fatalf("bad name = %v", err)
	}
	token, err := agents.Add("nixos")
	if err != nil {
		t.Fatal(err)
	}
	if token == "" {
		t.Fatal("empty token")
	}
	if _, err := agents.Add("NIXOS"); !errors.Is(err, ErrMachineExists) {
		t.Fatalf("duplicate = %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("mode = %o", perm)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), token) {
		t.Fatal("plain token is stored")
	}
	if !strings.Contains(string(raw), hashToken(token)) {
		t.Fatal("token hash is not stored")
	}
	var file agentsFile
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Machines) != 1 || file.Machines[0].Name != "nixos" || file.Machines[0].Added == 0 {
		t.Fatalf("file = %+v", file)
	}

	for _, tc := range []struct {
		name  string
		token string
		want  bool
	}{
		{"known", token, true},
		{"empty", "", false},
		{"garbage", "nope", false},
		{"suffix", token + "x", false},
	} {
		machine, ok := agents.Authorize(tc.token)
		if ok != tc.want {
			t.Fatalf("%s: authorized = %v", tc.name, ok)
		}
		if ok && machine.Name != "nixos" {
			t.Fatalf("%s: machine = %q", tc.name, machine.Name)
		}
	}

	reopened, err := OpenAgents(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := reopened.Authorize(token); !ok {
		t.Fatal("token lost after reopen")
	}
	if err := reopened.Remove("nixos"); err != nil {
		t.Fatal(err)
	}
	if _, ok := reopened.Authorize(token); ok {
		t.Fatal("removed token still works")
	}
	if err := reopened.Remove("nixos"); !errors.Is(err, ErrNoMachine) {
		t.Fatalf("second remove = %v", err)
	}
}

func TestAgentSocketRejectsBadToken(t *testing.T) {
	agents := testAgents(t)
	if _, err := agents.Add("nixos"); err != nil {
		t.Fatal(err)
	}
	server := testAgentServer(t, agents)
	for _, tc := range []struct {
		name string
		auth string
	}{
		{"absent", ""},
		{"garbage", "Bearer deadbeef"},
		{"not bearer", "Basic deadbeef"},
	} {
		request, err := http.NewRequest(http.MethodGet, server.URL+"/agent", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Upgrade", "websocket")
		request.Header.Set("Connection", "Upgrade")
		request.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		request.Header.Set("Sec-WebSocket-Version", "13")
		if tc.auth != "" {
			request.Header.Set("Authorization", tc.auth)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s: status = %d", tc.name, response.StatusCode)
		}
	}
}

func dialAgent(t *testing.T, server *httptest.Server, name, token string) *WSConn {
	t.Helper()
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/agent"
	ws, err := DialWebSocket(context.Background(), endpoint, http.Header{"Authorization": {"Bearer " + token}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.Close() })
	return ws
}

func sendHello(t *testing.T, ws *WSConn, name string, protocol int) {
	t.Helper()
	hello := AgentFrame{Type: "hello", Name: name, Protocol: protocol, Version: "test"}
	if err := ws.WriteJSON(hello); err != nil {
		t.Fatal(err)
	}
}

func readFrame(t *testing.T, ws *WSConn) AgentFrame {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		op, data, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("read frame: %v", err)
		}
		if op != wsText {
			continue
		}
		var frame AgentFrame
		if err := json.Unmarshal(data, &frame); err != nil {
			t.Fatalf("frame %q: %v", data, err)
		}
		return frame
	}
}

func TestAgentHelloWelcome(t *testing.T) {
	agents := testAgents(t)
	token, err := agents.Add("nixos")
	if err != nil {
		t.Fatal(err)
	}
	server := testAgentServer(t, agents)

	ws := dialAgent(t, server, "nixos", token)
	sendHello(t, ws, "nixos", agentProtocol)
	welcome := readFrame(t, ws)
	if welcome.Type != "welcome" || welcome.Session == "" {
		t.Fatalf("welcome = %+v", welcome)
	}
	if delta := time.Now().Unix() - welcome.Time; delta < 0 || delta > 5 {
		t.Fatalf("welcome time = %d", welcome.Time)
	}

	for _, tc := range []struct {
		name     string
		machine  string
		protocol int
	}{
		{"wrong name", "other", agentProtocol},
		{"wrong protocol", "nixos", agentProtocol + 1},
	} {
		conn := dialAgent(t, server, tc.machine, token)
		sendHello(t, conn, tc.machine, tc.protocol)
		conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		_, _, err := conn.ReadMessage()
		if !errors.Is(err, errWSClosed) {
			t.Fatalf("%s: close = %v", tc.name, err)
		}
	}
}

func TestAgentStateAndEvents(t *testing.T) {
	agents := testAgents(t)
	token, err := agents.Add("nixos")
	if err != nil {
		t.Fatal(err)
	}
	server := testAgentServer(t, agents)
	ws := dialAgent(t, server, "nixos", token)
	sendHello(t, ws, "nixos", agentProtocol)
	readFrame(t, ws)

	state := AgentFrame{
		Type:     "state",
		OpenCode: &AgentOpenCode{Version: "2.1.4", URL: "http://127.0.0.1:49374"},
		Targets:  []AgentTarget{{Name: "opencode", Kind: "http", Detail: "http://127.0.0.1:49374"}},
		Dirs:     []string{"/home/bongdo/Projects"},
	}
	if err := ws.WriteJSON(state); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := ws.WriteJSON(AgentFrame{Type: "evt", Event: json.RawMessage(`{"type":"session.idle"}`)}); err != nil {
			t.Fatal(err)
		}
	}

	machine := waitAgent(t, server, func(view machineView) bool {
		return view.Online && view.Events == 2 && view.OpenCode.Version != ""
	})
	if machine.Name != "nixos" {
		t.Fatalf("machine = %+v", machine)
	}
	if machine.Version != "test" {
		t.Fatalf("bridge version = %q", machine.Version)
	}
	if machine.OpenCode.Version != "2.1.4" || machine.OpenCode.URL != "http://127.0.0.1:49374" {
		t.Fatalf("opencode = %+v", machine.OpenCode)
	}
	if len(machine.Targets) != 1 || machine.Targets[0].Name != "opencode" || machine.Targets[0].Kind != "http" {
		t.Fatalf("targets = %+v", machine.Targets)
	}
	if len(machine.Dirs) != 1 || machine.Dirs[0] != "/home/bongdo/Projects" {
		t.Fatalf("dirs = %+v", machine.Dirs)
	}
}

func agentStatus(t *testing.T, server *httptest.Server) []machineView {
	t.Helper()
	header, value := agentIdentity()
	request, err := http.NewRequest(http.MethodGet, server.URL+"/api/agents", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set(header, value)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("/api/agents = %d", response.StatusCode)
	}
	var list struct {
		Machines []machineView `json:"machines"`
	}
	if err := json.NewDecoder(response.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	return list.Machines
}

func waitAgent(t *testing.T, server *httptest.Server, ready func(machineView) bool) machineView {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, machine := range agentStatus(t, server) {
			if ready(machine) {
				return machine
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("machine did not reach the expected state")
	return machineView{}
}

func sendState(t *testing.T, ws *WSConn, targets ...AgentTarget) {
	t.Helper()
	state := AgentFrame{
		Type:     "state",
		OpenCode: &AgentOpenCode{Version: "2.1.4", URL: "http://127.0.0.1:49374"},
		Targets:  targets,
		Dirs:     []string{},
	}
	if err := ws.WriteJSON(state); err != nil {
		t.Fatal(err)
	}
}

func fakeBridge(t *testing.T, ws *WSConn, base map[string]string) {
	t.Helper()
	go func() {
		for {
			op, data, err := ws.ReadMessage()
			if err != nil {
				return
			}
			if op != wsText {
				continue
			}
			var frame AgentFrame
			if json.Unmarshal(data, &frame) != nil || frame.Type != "req" {
				continue
			}
			upstream, ok := base[frame.Target]
			if !ok {
				_ = ws.WriteJSON(AgentFrame{Type: "res", ID: frame.ID, Status: 502, Error: "unknown target"})
				_ = ws.WriteJSON(AgentFrame{Type: "end", ID: frame.ID})
				continue
			}
			go fakeForward(ws, upstream, frame)
		}
	}()
}

func fakeForward(ws *WSConn, base string, frame AgentFrame) {
	var body []byte
	if frame.Body != "" {
		body, _ = base64.StdEncoding.DecodeString(frame.Body)
	}
	request, err := http.NewRequest(frame.Method, base+frame.Path, bytes.NewReader(body))
	if err != nil {
		_ = ws.WriteJSON(AgentFrame{Type: "res", ID: frame.ID, Status: 502, Error: err.Error()})
		_ = ws.WriteJSON(AgentFrame{Type: "end", ID: frame.ID})
		return
	}
	for name, values := range frame.Headers {
		for _, value := range values {
			request.Header.Add(name, value)
		}
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		_ = ws.WriteJSON(AgentFrame{Type: "res", ID: frame.ID, Status: 502, Error: err.Error()})
		_ = ws.WriteJSON(AgentFrame{Type: "end", ID: frame.ID})
		return
	}
	defer response.Body.Close()
	_ = ws.WriteJSON(AgentFrame{Type: "res", ID: frame.ID, Status: response.StatusCode, Headers: response.Header})
	buf := make([]byte, 16*1024)
	for {
		n, err := response.Body.Read(buf)
		if n > 0 {
			_ = ws.WriteJSON(AgentFrame{Type: "chunk", ID: frame.ID, Body: base64.StdEncoding.EncodeToString(buf[:n])})
		}
		if err != nil {
			break
		}
	}
	_ = ws.WriteJSON(AgentFrame{Type: "end", ID: frame.ID})
}

func readyBridge(t *testing.T, server *httptest.Server, agents *Agents, token, base string) *WSConn {
	t.Helper()
	ws := dialAgent(t, server, "nixos", token)
	sendHello(t, ws, "nixos", agentProtocol)
	if welcome := readFrame(t, ws); welcome.Type != "welcome" {
		t.Fatalf("welcome = %+v", welcome)
	}
	sendState(t, ws, AgentTarget{Name: "opencode", Kind: "http", Detail: base})
	waitAgent(t, server, func(view machineView) bool { return view.Online && len(view.Targets) == 1 })
	return ws
}

func instanceRequest(t *testing.T, method, target string, body io.Reader) *http.Request {
	t.Helper()
	request, err := http.NewRequest(method, target, body)
	if err != nil {
		t.Fatal(err)
	}
	header, value := agentIdentity()
	request.Header.Set(header, value)
	return request
}

func TestAgentProxyRoundtrip(t *testing.T) {
	type seen struct {
		sync.Mutex
		method string
		uri    string
		body   string
		header http.Header
	}
	var got seen
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got.Lock()
		got.method, got.uri, got.body, got.header = r.Method, r.URL.RequestURI(), string(body), r.Header.Clone()
		got.Unlock()
		w.Header().Set("X-Upstream", "yes")
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, "from upstream")
	}))
	defer upstream.Close()

	agents := testAgents(t)
	token, err := agents.Add("nixos")
	if err != nil {
		t.Fatal(err)
	}
	server := testAgentServer(t, agents)
	ws := readyBridge(t, server, agents, token, upstream.URL)
	fakeBridge(t, ws, map[string]string{"opencode": upstream.URL})

	request := instanceRequest(t, http.MethodPost, server.URL+"/i/nixos/opencode/api/sessions?x=1", strings.NewReader(`{"q":1}`))
	request.Header.Set("X-Test", "1")
	request.Header.Set("Cookie", "gate_session=secret")
	request.Header.Set("Authorization", "Bearer secret")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.StatusCode, body)
	}
	if response.Header.Get("X-Upstream") != "yes" {
		t.Fatalf("headers = %v", response.Header)
	}
	if string(body) != "from upstream" {
		t.Fatalf("body = %q", body)
	}

	got.Lock()
	defer got.Unlock()
	if got.method != http.MethodPost {
		t.Fatalf("upstream method = %q", got.method)
	}
	if got.uri != "/api/sessions?x=1" {
		t.Fatalf("upstream uri = %q", got.uri)
	}
	if got.body != `{"q":1}` {
		t.Fatalf("upstream body = %q", got.body)
	}
	if got.header.Get("X-Test") != "1" {
		t.Fatalf("upstream headers = %v", got.header)
	}
	for _, name := range []string{"Cookie", "Authorization", gateid.Header} {
		if got.header.Get(name) != "" {
			t.Fatalf("%s leaked upstream", name)
		}
	}
}

func TestAgentProxyErrors(t *testing.T) {
	agents := testAgents(t)
	token, err := agents.Add("nixos")
	if err != nil {
		t.Fatal(err)
	}
	server := testAgentServer(t, agents)

	response, err := http.DefaultClient.Do(instanceRequest(t, http.MethodGet, server.URL+"/i/nixos/opencode/api/info", nil))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusBadGateway || !strings.Contains(string(body), "machine offline") {
		t.Fatalf("offline = %d %s", response.StatusCode, body)
	}

	ws := readyBridge(t, server, agents, token, "http://127.0.0.1:1")
	defer ws.Close()

	response, err = http.DefaultClient.Do(instanceRequest(t, http.MethodGet, server.URL+"/i/nixos/pero/", nil))
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound || !strings.Contains(string(body), "unknown target") {
		t.Fatalf("unknown target = %d %s", response.StatusCode, body)
	}

	response, err = http.DefaultClient.Do(instanceRequest(t, http.MethodGet, server.URL+"/i/ghost/opencode/", nil))
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound || !strings.Contains(string(body), "unknown machine") {
		t.Fatalf("unknown machine = %d %s", response.StatusCode, body)
	}
}

func TestAgentProxyRequiresIdentity(t *testing.T) {
	agents := testAgents(t)
	if _, err := agents.Add("nixos"); err != nil {
		t.Fatal(err)
	}
	server := testAgentServer(t, agents)
	response, err := http.Get(server.URL + "/i/nixos/opencode/api/info")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if contentType := response.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("content type = %q", contentType)
	}
	if strings.Contains(string(body), "<html") {
		t.Fatalf("login page returned: %s", body)
	}
}

func TestAgentProxyStreamsChunks(t *testing.T) {
	agents := testAgents(t)
	token, err := agents.Add("nixos")
	if err != nil {
		t.Fatal(err)
	}
	server := testAgentServer(t, agents)
	ws := readyBridge(t, server, agents, token, "http://127.0.0.1:1")
	firstSeen := make(chan struct{})

	go func() {
		for {
			op, data, err := ws.ReadMessage()
			if err != nil {
				return
			}
			if op != wsText {
				continue
			}
			var frame AgentFrame
			if json.Unmarshal(data, &frame) != nil || frame.Type != "req" {
				continue
			}
			_ = ws.WriteJSON(AgentFrame{Type: "res", ID: frame.ID, Status: http.StatusOK, Headers: map[string][]string{"Content-Type": {"text/event-stream"}}})
			_ = ws.WriteJSON(AgentFrame{Type: "chunk", ID: frame.ID, Body: base64.StdEncoding.EncodeToString([]byte("data: one\n\n"))})
			select {
			case <-firstSeen:
			case <-time.After(2 * time.Second):
				return
			}
			_ = ws.WriteJSON(AgentFrame{Type: "chunk", ID: frame.ID, Body: base64.StdEncoding.EncodeToString([]byte("data: two\n\n"))})
			_ = ws.WriteJSON(AgentFrame{Type: "end", ID: frame.ID})
			return
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request := instanceRequest(t, http.MethodGet, server.URL+"/i/nixos/opencode/api/events", nil).WithContext(ctx)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if contentType := response.Header.Get("Content-Type"); contentType != "text/event-stream" {
		t.Fatalf("content type = %q", contentType)
	}
	reader := bufio.NewReader(response.Body)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("first chunk was not flushed: %v", err)
	}
	if line != "data: one\n" {
		t.Fatalf("first line = %q", line)
	}
	close(firstSeen)
	line, err = reader.ReadString('\n')
	if err != nil {
		t.Fatalf("second chunk: %v", err)
	}
	if line != "\n" {
		t.Fatalf("second line = %q", line)
	}
	line, err = reader.ReadString('\n')
	if err != nil {
		t.Fatalf("third chunk: %v", err)
	}
	if line != "data: two\n" {
		t.Fatalf("third line = %q", line)
	}
}

func TestInvitePathIsNotShadowed(t *testing.T) {
	server, _ := testServer(t, nil)
	response, err := http.Get(server.URL + "/i/sometoken")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if contentType := response.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "text/html") {
		t.Fatalf("content type = %q", contentType)
	}
}

func TestInstancePath(t *testing.T) {
	for _, tc := range []struct {
		path    string
		machine string
		target  string
		rest    string
		ok      bool
	}{
		{"/i/nixos/opencode/api/sessions?x=1", "nixos", "opencode", "/api/sessions?x=1", true},
		{"/i/nixos/opencode", "nixos", "opencode", "/", true},
		{"/i/nixos/opencode/", "nixos", "opencode", "/", true},
		{"/i/nixos", "", "", "", false},
		{"/i/../opencode/x", "", "", "", false},
		{"/nit/opencode", "", "", "", false},
	} {
		machine, target, rest, ok := instancePath(mustURL(t, tc.path))
		if ok != tc.ok || machine != tc.machine || target != tc.target || rest != tc.rest {
			t.Fatalf("%s = %q %q %q %v", tc.path, machine, target, rest, ok)
		}
	}
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

func TestWebSocketHandshake(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := AcceptWebSocket(w, r)
		if err != nil {
			return
		}
		defer ws.Close()
		op, data, err := ws.ReadMessage()
		if err != nil {
			return
		}
		_ = ws.WriteText(append([]byte(fmt.Sprintf("%d:", op)), data...))
	}))
	defer server.Close()

	conn, err := net.Dial("tcp", strings.TrimPrefix(server.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, err = fmt.Fprintf(conn, "GET / HTTP/1.1\r\nHost: gate\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status = %s", response.Status)
	}
	if accept := response.Header.Get("Sec-WebSocket-Accept"); accept != "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=" {
		t.Fatalf("accept = %q", accept)
	}

	client, err := DialWebSocket(context.Background(), "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err := client.WriteText([]byte("hi")); err != nil {
		t.Fatal(err)
	}
	_, data, err := client.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "1:hi" {
		t.Fatalf("echo = %q", data)
	}
}
