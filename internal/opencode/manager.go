package opencode

import "context"

type Manager struct {
	registry *Registry
}

func NewManager() *Manager {
	return &Manager{registry: NewRegistry()}
}

func (m *Manager) Client(ctx context.Context) (*Client, error) {
	return m.registry.Client(ctx)
}

func (m *Manager) Drop() {
	m.registry.Drop()
}
