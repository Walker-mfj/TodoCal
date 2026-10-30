package models

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}
type Principal struct {
	User
	SessionID string
	CSRFHash  string
	Token     string
}
