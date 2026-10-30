package models

type GroupInput struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}
type Group struct {
	GroupInput
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}
