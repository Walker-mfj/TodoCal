// Package config validates the API's environment before opening a database.
package config

import (
	"errors"
	"net/url"
	"strconv"
)

type Config struct {
	DatabaseURL, Origin, Address string
	Secure                       bool
	NotificationScheduler        bool
}

func Load(getenv func(string) string) (Config, error) {
	c := Config{DatabaseURL: getenv("DATABASE_URL"), Origin: getenv("APP_ORIGIN"), Address: getenv("API_ADDR")}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	if c.Origin == "" {
		c.Origin = "http://localhost:3000"
	}
	if c.Address == "" {
		c.Address = "127.0.0.1:8080"
	}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return c, errors.New("APP_ORIGIN must be an HTTP(S) origin without a path")
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !local {
		return c, errors.New("non-local APP_ORIGIN requires HTTPS")
	}
	c.Secure = u.Scheme == "https"
	if v := getenv("NOTIFICATION_SCHEDULER_ENABLED"); v != "" {
		c.NotificationScheduler, err = strconv.ParseBool(v)
		if err != nil {
			return c, errors.New("NOTIFICATION_SCHEDULER_ENABLED must be true or false")
		}
	}
	if v := getenv("COOKIE_SECURE"); v != "" {
		c.Secure, err = strconv.ParseBool(v)
		if err != nil {
			return c, errors.New("COOKIE_SECURE must be true or false")
		}
	}
	if u.Scheme == "https" && !c.Secure {
		return c, errors.New("HTTPS requires secure cookies")
	}
	return c, nil
}
