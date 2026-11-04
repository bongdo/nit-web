package opencode

import (
	"context"
	"sync"
	"time"
)

type Manager struct {
	mu       sync.Mutex
	client   *Client
	resolved time.Time
	discover func(context.Context) (Endpoint, error)
}

func NewManager() *Manager {
	return &Manager{discover: Discover}
}

func (m *Manager) Client(ctx context.Context) (*Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client != nil && time.Since(m.resolved) < 10*time.Second {
		return m.client, nil
	}
	ep, err := m.discover(ctx)
	if err != nil {
		m.client = nil
		return nil, err
	}
	m.client = New(ep)
	m.resolved = time.Now()
	return m.client, nil
}

func (m *Manager) Drop() {
	m.mu.Lock()
	m.client = nil
	m.mu.Unlock()
}
