package opencode

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const maxUpstreamBody = 64 << 20

type HTTPError struct {
	Status int
	Body   []byte
}

func (e *HTTPError) Error() string {
	var v struct {
		Tag     string `json:"_tag"`
		Message string `json:"message"`
	}
	if json.Unmarshal(e.Body, &v) == nil && v.Message != "" {
		return v.Message
	}
	return fmt.Sprintf("upstream returned %d", e.Status)
}

type Client struct {
	BaseURL    string
	Password   string
	HTTP       *http.Client
	StreamHTTP *http.Client
	refresh    func() (string, bool)

	mu sync.RWMutex
}

func New(ep Endpoint) *Client {
	return &Client{
		BaseURL:  strings.TrimRight(ep.URL, "/"),
		Password: ep.Password,
		HTTP: &http.Client{
			Timeout:   20 * time.Second,
			Transport: defaultTransport(),
		},
		StreamHTTP: &http.Client{
			Transport: defaultTransport(),
		},
		refresh: func() (string, bool) {
			pw := ReadPassword()
			return pw, pw != ""
		},
	}
}

func defaultTransport() *http.Transport {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.MaxIdleConnsPerHost = 8
	t.ResponseHeaderTimeout = 15 * time.Second
	return t
}

func (c *Client) password() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.Password
}

func (c *Client) refreshPassword() bool {
	f := c.refresh
	if f == nil {
		return false
	}
	pw, ok := f()
	if ok {
		c.mu.Lock()
		c.Password = pw
		c.mu.Unlock()
	}
	return ok
}

func (c *Client) newRequest(ctx context.Context, method, path string, body any) (*http.Request, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, rdr)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth("opencode", c.password())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	return req, nil
}

func (c *Client) Do(ctx context.Context, method, path string, body, out any) error {
	req, err := c.newRequest(ctx, method, path, body)
	if err != nil {
		return err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized && c.refreshPassword() {
		req, err = c.newRequest(ctx, method, path, body)
		if err != nil {
			return err
		}
		resp.Body.Close()
		resp, err = c.HTTP.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxUpstreamBody))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return &HTTPError{Status: resp.StatusCode, Body: c.redact(raw)}
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func (c *Client) Stream(ctx context.Context, path string) (*http.Response, error) {
	req, err := c.newRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := c.StreamHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized && c.refreshPassword() {
		req, err = c.newRequest(ctx, http.MethodGet, path, nil)
		if err != nil {
			resp.Body.Close()
			return nil, err
		}
		req.Header.Set("Accept", "text/event-stream")
		req.Header.Set("Cache-Control", "no-cache")
		resp.Body.Close()
		resp, err = c.StreamHTTP.Do(req)
		if err != nil {
			return nil, err
		}
	}
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		resp.Body.Close()
		return nil, &HTTPError{Status: resp.StatusCode, Body: c.redact(raw)}
	}
	return resp, nil
}

func (c *Client) redact(body []byte) []byte {
	return c.Redactor().Bytes(body)
}

func IsNotFound(err error) bool {
	var e *HTTPError
	return errors.As(err, &e) && e.Status == http.StatusNotFound
}
