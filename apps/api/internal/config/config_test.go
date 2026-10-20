package config

import "testing"

func TestConfigRejectsUnsafeOrIncompleteDeployment(t *testing.T) {
	for _, env := range []map[string]string{
		{},
		{"DATABASE_URL": "postgres://localhost/focus", "APP_ORIGIN": "https://example.com", "COOKIE_SECURE": "false"},
		{"DATABASE_URL": "postgres://localhost/focus", "APP_ORIGIN": "http://example.com", "COOKIE_SECURE": "false"},
		{"DATABASE_URL": "postgres://localhost/focus", "APP_ORIGIN": "http://localhost:3000/path"},
		{"DATABASE_URL": "postgres://localhost/focus", "COOKIE_SECURE": "typo"},
	} {
		if _, err := Load(func(k string) string { return env[k] }); err == nil {
			t.Fatalf("accepted invalid configuration: %v", env)
		}
	}
}
func TestConfigAllowsLocalAndHTTPS(t *testing.T) {
	for _, origin := range []string{"http://localhost:3000", "https://focus.example.com"} {
		env := map[string]string{"DATABASE_URL": "postgres://localhost/focus", "APP_ORIGIN": origin}
		cfg, err := Load(func(k string) string { return env[k] })
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Secure != (origin == "https://focus.example.com") {
			t.Fatal("cookie policy inconsistent with origin")
		}
		if cfg.Address != "127.0.0.1:8080" {
			t.Fatal("API must bind loopback by default")
		}
	}
}
