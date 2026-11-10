// Package services implements account business operations within shared transactions.
package services

import "focuscalendar/internal/models"

type Fault = models.Fault

func Invalid(message string) error { return &Fault{Code: "validation", Message: message} }

func Missing() error { return &Fault{Code: "not_found", Message: "Resource not found"} }

func Conflict() error {
	return &Fault{Code: "revision_conflict", Message: "This item changed. Refresh and try again."}
}
