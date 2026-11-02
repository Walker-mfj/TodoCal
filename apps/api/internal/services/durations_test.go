package services

import "testing"

func TestValidateDurationBounds(t *testing.T) {
	for _, kind := range []string{"focus", "short_break", "long_break"} {
		maximum := int64(60)
		if kind == "focus" {
			maximum = 180
		}
		for _, minutes := range []int64{-1, 0, 1, maximum, maximum + 1, 2147483647} {
			valid := minutes >= 1 && minutes <= maximum
			if err := validateDuration(kind, minutes); (err == nil) != valid {
				t.Errorf("%s %d: %v", kind, minutes, err)
			}
		}
	}
}
