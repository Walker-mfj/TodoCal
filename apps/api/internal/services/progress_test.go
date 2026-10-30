package services

import "testing"

func TestProgressDoesNotClaimCompletionForAnIncompletePlan(t *testing.T) {
	if percentage(0, 0) != nil {
		t.Fatal("empty day is not zero percent")
	}
	if got := percentage(10001, 10000); got == nil || *got != 99.9 {
		t.Fatal("rounded an incomplete plan to complete", got)
	}
	if got := percentage(5, 5); got == nil || *got != 100 {
		t.Fatal("complete plan must be 100 percent", got)
	}
}
