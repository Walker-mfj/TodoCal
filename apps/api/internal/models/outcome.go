package models

// Outcome describes a successful mutation independently of its transport.
type Outcome uint8

const (
	Updated Outcome = iota
	Created
)
