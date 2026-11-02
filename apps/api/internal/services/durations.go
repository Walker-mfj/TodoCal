package services

// validateDuration checks settings and resolved default durations before a
// timer is created. Persisted values from older API versions are not trusted.
func validateDuration(kind string, minutes int64) error {
	maximum := int64(60)
	if kind == "focus" {
		maximum = 180
	}
	if minutes < 1 || minutes > maximum {
		if kind == "focus" {
			return Invalid("Focus duration must be between 1 and 180 minutes")
		}
		return Invalid("Break duration must be between 1 and 60 minutes")
	}
	return nil
}
