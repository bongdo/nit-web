package gate

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	totpStep   = 30
	totpDigits = 6
	totpWindow = 1
	totpIssuer = "bongdo.space"
)

var errBadTOTP = errors.New("gate: invalid one-time code")

var totpBase32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func newTOTPSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return totpBase32.EncodeToString(buf), nil
}

func normalizeTOTPSecret(secret string) string {
	clean := strings.ToUpper(secret)
	return strings.NewReplacer(" ", "", "-", "", "=", "").Replace(clean)
}

func totpAt(secret string, step int64) (string, error) {
	key, err := totpBase32.DecodeString(normalizeTOTPSecret(secret))
	if err != nil || len(key) == 0 {
		return "", errBadTOTP
	}
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, key)
	mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", totpDigits, value%1_000_000), nil
}

func totpStepOf(now time.Time) int64 {
	return now.Unix() / totpStep
}

func totpMatch(secret, code string, now time.Time, after int64) (int64, bool) {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return 0, false
	}
	current := totpStepOf(now)
	for delta := int64(-totpWindow); delta <= totpWindow; delta++ {
		step := current + delta
		if step <= after {
			continue
		}
		want, err := totpAt(secret, step)
		if err != nil {
			return 0, false
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return step, true
		}
	}
	return 0, false
}

func otpauthURL(account, secret string) string {
	query := url.Values{}
	query.Set("secret", secret)
	query.Set("issuer", totpIssuer)
	query.Set("algorithm", "SHA1")
	query.Set("digits", strconv.Itoa(totpDigits))
	query.Set("period", strconv.Itoa(totpStep))
	return "otpauth://totp/" + url.PathEscape(totpIssuer+":"+account) + "?" + query.Encode()
}

func newRecoveryCodes(count int) ([]string, []string, error) {
	plain := make([]string, 0, count)
	hashed := make([]string, 0, count)
	for i := 0; i < count; i++ {
		buf := make([]byte, 5)
		if _, err := rand.Read(buf); err != nil {
			return nil, nil, err
		}
		raw := totpBase32.EncodeToString(buf)
		code := raw[:5] + "-" + raw[5:]
		plain = append(plain, code)
		hashed = append(hashed, hashRecovery(code))
	}
	return plain, hashed, nil
}

func hashRecovery(code string) string {
	sum := sha256.Sum256([]byte(normalizeRecovery(code)))
	return hex.EncodeToString(sum[:])
}

func normalizeRecovery(code string) string {
	clean := strings.ToUpper(code)
	return strings.NewReplacer(" ", "", "-", "").Replace(clean)
}

func groupSecret(secret string) string {
	parts := make([]string, 0, (len(secret)+3)/4)
	for len(secret) > 4 {
		parts = append(parts, secret[:4])
		secret = secret[4:]
	}
	if secret != "" {
		parts = append(parts, secret)
	}
	return strings.Join(parts, " ")
}
