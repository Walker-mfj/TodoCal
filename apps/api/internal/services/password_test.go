package services

import (
	"strings"
	"testing"
)

func TestPasswordsAreSaltedAndNeverTruncated(t *testing.T) {
	p := strings.Repeat("界", 128)
	if !validPassword(p) || validPassword(p+"界") || validPassword("short") {
		t.Fatal("invalid character boundaries")
	}
	a, b := hashPassword(p), hashPassword(p)
	if a == b {
		t.Fatal("password salts reused")
	}
	if !verifyPassword(a, p) || verifyPassword(a, p+"x") || verifyPassword(a, "wrong password") {
		t.Fatal("password verification failed")
	}
	for _, bad := range []string{"", "$argon2id$v=19$m=65536,t=3,p=2$bad$bad", strings.Replace(a, "m=65536", "m=999999999999", 1)} {
		if verifyPassword(bad, p) {
			t.Fatal("malformed hash accepted")
		}
	}
}
