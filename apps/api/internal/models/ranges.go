package models

import "time"

type Range struct {
	From           string
	To             string
	Cutoff         time.Time
	PreviousFrom   string
	PreviousTo     string
	PreviousCutoff time.Time
}
