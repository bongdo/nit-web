package gate

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	wsText  = 0x1
	wsClose = 0x8
	wsPing  = 0x9
	wsPong  = 0xa

	wsMaxFrame = 1 << 20
	wsGUID     = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
)

var (
	errWSFrameTooLarge = errors.New("gate: websocket frame too large")
	errWSClosed        = errors.New("gate: websocket closed")
)

type wsConn struct {
	conn        net.Conn
	br          *bufio.Reader
	readMasked  bool
	writeMasked bool
	wmu         sync.Mutex
	once        sync.Once
}

func wsAccept(key string) string {
	sum := sha1.Sum([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func headerHasToken(header http.Header, name string, token string) bool {
	for _, value := range header.Values(name) {
		for _, part := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(part), token) {
				return true
			}
		}
	}
	return false
}

func AcceptWebSocket(w http.ResponseWriter, r *http.Request) (*wsConn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || !headerHasToken(r.Header, "Connection", "upgrade") {
		w.Header().Set("Upgrade", "websocket")
		w.Header().Set("Connection", "Upgrade")
		w.Header().Set("Sec-WebSocket-Version", "13")
		http.Error(w, "websocket upgrade required", http.StatusUpgradeRequired)
		return nil, errors.New("gate: not a websocket upgrade")
	}
	if r.Header.Get("Sec-WebSocket-Version") != "13" {
		w.Header().Set("Sec-WebSocket-Version", "13")
		http.Error(w, "unsupported websocket version", http.StatusUpgradeRequired)
		return nil, errors.New("gate: unsupported websocket version")
	}
	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	if key == "" {
		http.Error(w, "missing websocket key", http.StatusBadRequest)
		return nil, errors.New("gate: missing websocket key")
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "websocket not supported", http.StatusInternalServerError)
		return nil, errors.New("gate: response writer cannot be hijacked")
	}
	conn, rw, err := hijacker.Hijack()
	if err != nil {
		return nil, err
	}
	response := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n"
	if _, err := rw.WriteString(response); err != nil {
		conn.Close()
		return nil, err
	}
	if err := rw.Flush(); err != nil {
		conn.Close()
		return nil, err
	}
	return &wsConn{conn: conn, br: rw.Reader, readMasked: true}, nil
}

func DialWebSocket(ctx context.Context, rawURL string, header http.Header) (*wsConn, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if u.Host == "" {
		return nil, errors.New("gate: websocket url has no host")
	}
	secure := false
	switch u.Scheme {
	case "ws", "http":
	case "wss", "https":
		secure = true
	default:
		return nil, fmt.Errorf("gate: unsupported websocket scheme %q", u.Scheme)
	}
	addr := u.Host
	if u.Port() == "" {
		port := "80"
		if secure {
			port = "443"
		}
		addr = net.JoinHostPort(u.Hostname(), port)
	}
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	if secure {
		tlsConn := tls.Client(conn, &tls.Config{ServerName: u.Hostname()})
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			conn.Close()
			return nil, err
		}
		conn = tlsConn
	}
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		conn.Close()
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)
	var request strings.Builder
	fmt.Fprintf(&request, "GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n", u.RequestURI(), u.Host, key)
	for name, values := range header {
		for _, value := range values {
			fmt.Fprintf(&request, "%s: %s\r\n", name, value)
		}
	}
	request.WriteString("\r\n")
	if _, err := io.WriteString(conn, request.String()); err != nil {
		conn.Close()
		return nil, err
	}
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, &http.Request{Method: http.MethodGet, URL: u})
	if err != nil {
		conn.Close()
		return nil, err
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		conn.Close()
		return nil, fmt.Errorf("gate: websocket handshake: %s", resp.Status)
	}
	if !strings.EqualFold(resp.Header.Get("Upgrade"), "websocket") || resp.Header.Get("Sec-WebSocket-Accept") != wsAccept(key) {
		conn.Close()
		return nil, errors.New("gate: websocket handshake rejected")
	}
	return &wsConn{conn: conn, br: br, writeMasked: true}, nil
}

func (c *wsConn) SetReadDeadline(t time.Time) error {
	return c.conn.SetReadDeadline(t)
}

func (c *wsConn) Close() error {
	var err error
	c.once.Do(func() { err = c.conn.Close() })
	return err
}

func (c *wsConn) WriteText(payload []byte) error {
	return c.writeFrame(wsText, payload)
}

func (c *wsConn) WriteJSON(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(payload) > wsMaxFrame {
		return errWSFrameTooLarge
	}
	return c.writeFrame(wsText, payload)
}

func (c *wsConn) WritePing() error {
	return c.writeFrame(wsPing, nil)
}

func (c *wsConn) WriteClose(code int, reason string) error {
	payload := make([]byte, 2+len(reason))
	binary.BigEndian.PutUint16(payload, uint16(code))
	copy(payload[2:], reason)
	return c.writeFrame(wsClose, payload)
}

func (c *wsConn) writeFrame(op int, payload []byte) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	head := make([]byte, 0, 14)
	head = append(head, 0x80|byte(op))
	n := len(payload)
	switch {
	case n < 126:
		head = append(head, byte(n))
	case n <= 0xffff:
		head = append(head, 126, 0, 0)
		binary.BigEndian.PutUint16(head[2:], uint16(n))
	default:
		head = append(head, 127, 0, 0, 0, 0, 0, 0, 0, 0)
		binary.BigEndian.PutUint64(head[2:], uint64(n))
	}
	if c.writeMasked {
		head[1] |= 0x80
		var key [4]byte
		if _, err := rand.Read(key[:]); err != nil {
			return err
		}
		head = append(head, key[:]...)
		masked := make([]byte, n)
		for i := range payload {
			masked[i] = payload[i] ^ key[i%4]
		}
		payload = masked
	}
	if _, err := c.conn.Write(head); err != nil {
		return err
	}
	_, err := c.conn.Write(payload)
	return err
}

func (c *wsConn) ReadMessage() (int, []byte, error) {
	op := 0
	var data []byte
	for {
		fin, frameOp, payload, err := c.readFrame()
		if err != nil {
			return 0, nil, err
		}
		switch frameOp {
		case wsPing:
			if err := c.WritePong(payload); err != nil {
				return 0, nil, err
			}
			continue
		case wsPong:
			continue
		case wsClose:
			_ = c.WriteClose(1000, "")
			return wsClose, payload, errWSClosed
		}
		if frameOp != 0 {
			op = frameOp
			data = payload
		} else {
			if op == 0 {
				return 0, nil, errors.New("gate: unexpected websocket continuation")
			}
			data = append(data, payload...)
		}
		if len(data) > wsMaxFrame {
			return 0, nil, errWSFrameTooLarge
		}
		if fin {
			return op, data, nil
		}
	}
}

func (c *wsConn) WritePong(payload []byte) error {
	if len(payload) > 125 {
		payload = payload[:125]
	}
	return c.writeFrame(wsPong, payload)
}

func (c *wsConn) readFrame() (bool, int, []byte, error) {
	var head [2]byte
	if _, err := io.ReadFull(c.br, head[:]); err != nil {
		return false, 0, nil, err
	}
	fin := head[0]&0x80 != 0
	if head[0]&0x70 != 0 {
		return false, 0, nil, errors.New("gate: websocket reserved bits set")
	}
	op := int(head[0] & 0x0f)
	mask := head[1]&0x80 != 0
	if mask != c.readMasked {
		return false, 0, nil, errors.New("gate: websocket masked bit mismatch")
	}
	length := int64(head[1] & 0x7f)
	switch length {
	case 126:
		var size [2]byte
		if _, err := io.ReadFull(c.br, size[:]); err != nil {
			return false, 0, nil, err
		}
		length = int64(binary.BigEndian.Uint16(size[:]))
	case 127:
		var size [8]byte
		if _, err := io.ReadFull(c.br, size[:]); err != nil {
			return false, 0, nil, err
		}
		length = int64(binary.BigEndian.Uint64(size[:]))
	}
	if op >= wsClose && (length > 125 || !fin) {
		return false, 0, nil, errors.New("gate: bad websocket control frame")
	}
	if length < 0 || length > wsMaxFrame {
		return false, 0, nil, errWSFrameTooLarge
	}
	var key [4]byte
	if mask {
		if _, err := io.ReadFull(c.br, key[:]); err != nil {
			return false, 0, nil, err
		}
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(c.br, payload); err != nil {
		return false, 0, nil, err
	}
	if mask {
		for i := range payload {
			payload[i] ^= key[i%4]
		}
	}
	return fin, op, payload, nil
}
