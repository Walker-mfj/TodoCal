package analytics

import "testing"

func TestIncompleteRatioNeverDisplaysFullCompletion(t *testing.T) {
	if p := percent(9999, 10000); p == nil || *p != 99.9 {
		t.Fatal(p)
	}
	if percent(0, 0) != nil {
		t.Fatal("empty plan has percentage")
	}
}
