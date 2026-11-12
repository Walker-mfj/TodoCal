package diagnostics

import (
	"io"
	"log/slog"
	"regexp"
)

var revisionPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)

func Logger(out io.Writer, release, environment string) *slog.Logger {
	if !revisionPattern.MatchString(release) {
		release = "unknown"
	}
	switch environment {
	case "development", "staging", "production":
	default:
		environment = "unknown"
	}
	return slog.New(slog.NewJSONHandler(out, nil)).With("service", "api", "environment", environment, "release", release)
}
