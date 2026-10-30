package services

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
)

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("secure random unavailable")
	}
	return hex.EncodeToString(b)
}
func tokenHash(v string) string { h := sha256.Sum256([]byte(v)); return hex.EncodeToString(h[:]) }
func equal(a, b string) bool    { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
