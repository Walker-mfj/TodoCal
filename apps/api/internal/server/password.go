package server

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"golang.org/x/crypto/argon2"
	"strings"
	"unicode/utf8"
)

const hashMemory uint32 = 64 * 1024
const hashIterations uint32 = 3
const hashParallelism uint8 = 2

func validPassword(p string) bool {
	n := utf8.RuneCountInString(p)
	return n >= 12 && n <= 128 && utf8.ValidString(p)
}
func hashPassword(password string) string {
	salt, _ := hex.DecodeString(randomToken(16))
	sum := argon2.IDKey([]byte(password), salt, hashIterations, hashMemory, hashParallelism, 32)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s", base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(sum))
}
func verifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != "m=65536,t=3,p=2" {
		return false
	}
	salt, e := base64.RawStdEncoding.DecodeString(parts[4])
	if e != nil || len(salt) != 16 {
		return false
	}
	expected, e := base64.RawStdEncoding.DecodeString(parts[5])
	if e != nil || len(expected) != 32 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, hashIterations, hashMemory, hashParallelism, 32)
	return equal(string(expected), string(actual))
}
