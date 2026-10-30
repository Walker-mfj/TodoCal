package services

import "time"

// Microseconds preserve sub-second intervals across repeated pauses. Unix arithmetic
// avoids time.Duration overflow for the full settings range of positive int32 minutes.
func ElapsedMicroseconds(Accumulated, targetSeconds int64, since *time.Time, now time.Time) int64 {
	elapsed := Accumulated
	if since != nil && now.After(*since) {
		elapsed += now.UnixMicro() - since.UnixMicro()
	}
	return min(targetSeconds*1000000, max(0, elapsed))
}
