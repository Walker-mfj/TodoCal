package services

import "focuscalendar/internal/models"

type Principal = models.Principal
type Parameters struct {
	ID, Action, Date string
	Query            Values
}
type Values map[string][]string

func (v Values) Get(k string) string {
	if a := v[k]; len(a) > 0 {
		return a[0]
	}
	return ""
}
