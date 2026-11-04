package services

import "testing"

func TestRefreshRetryResponseRequiresSecretAndFamily(t *testing.T) {
	secret := randomToken(32)
	original := SessionResult{Token: randomToken(32), Refresh: randomToken(32)}
	encrypted, err := sealRefreshResponse(secret, "family-one", original)
	if err != nil {
		t.Fatal(err)
	}
	var restored SessionResult
	if err := readRefreshResponse(secret, "family-one", encrypted, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Token != original.Token || restored.Refresh != original.Refresh {
		t.Fatal("retry credentials changed")
	}
	// A database leak includes the verifier hash but cannot decrypt credentials.
	if err := readRefreshResponse(tokenHash(secret), "family-one", encrypted, &restored); err == nil {
		t.Fatal("stored hash decrypted response")
	}
	if err := readRefreshResponse(secret, "family-two", encrypted, &restored); err == nil {
		t.Fatal("response accepted for another family")
	}
	encrypted[len(encrypted)-1] ^= 1
	if err := readRefreshResponse(secret, "family-one", encrypted, &restored); err == nil {
		t.Fatal("tampered response accepted")
	}
}
