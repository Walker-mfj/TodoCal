package services

import (
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"errors"
	"focuscalendar/internal/models"
	webpush "github.com/SherClockHolmes/webpush-go"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

type webPushSender struct {
	publicKey, privateKey, subject string
	client                         *http.Client
}

func NewWebPushSender(publicKey, privateKey, subject string) (PushSender, error) {
	if publicKey == "" && privateKey == "" && subject == "" {
		return nil, nil
	}
	pub, e := base64.RawURLEncoding.DecodeString(publicKey)
	if e != nil {
		return nil, errors.New("invalid VAPID public key")
	}
	priv, e := base64.RawURLEncoding.DecodeString(privateKey)
	if e != nil {
		return nil, errors.New("invalid VAPID private key")
	}
	key, e := ecdh.P256().NewPrivateKey(priv)
	if e != nil || base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()) != publicKey || len(pub) != 65 {
		return nil, errors.New("invalid VAPID key pair")
	}
	u, e := url.Parse(subject)
	if e != nil || !((u.Scheme == "mailto" && strings.Contains(u.Opaque, "@")) || (u.Scheme == "https" && u.Host != "")) {
		return nil, errors.New("VAPID subject must be a contact mailto or HTTPS URL")
	}
	transport := &http.Transport{DialContext: publicPushDial, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 5 * time.Second}
	return &webPushSender{publicKey: publicKey, privateKey: privateKey, subject: subject, client: &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func publicPushDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, e := net.SplitHostPort(address)
	if e != nil || port != "443" || !validPushEndpoint("https://"+host+"/") {
		return nil, errors.New("unsupported push host")
	}
	ips, e := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if e != nil {
		return nil, errors.New("push service resolution failed")
	}
	var last error
	for _, ip := range ips {
		if !publicPushIP(ip) {
			return nil, errors.New("nonpublic push service address")
		}
	}
	for _, ip := range ips {
		conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		last = err
	}
	if last == nil {
		last = errors.New("push service has no address")
	}
	return nil, last
}
func publicPushIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, s := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32"} {
		if netip.MustParsePrefix(s).Contains(ip) {
			return false
		}
	}
	return true
}
func (s *webPushSender) Send(ctx context.Context, in models.PushInput, payload []byte) (int, error) {
	if e := PushInput(in).Validate(); e != nil {
		return 0, e
	}
	response, e := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{Endpoint: in.Endpoint, Keys: webpush.Keys{P256dh: in.Keys.P256dh, Auth: in.Keys.Auth}}, &webpush.Options{HTTPClient: s.client, Subscriber: s.subject, VAPIDPublicKey: s.publicKey, VAPIDPrivateKey: s.privateKey, TTL: 300})
	if e != nil {
		return 0, errors.New("push delivery failed")
	}
	defer response.Body.Close()
	return response.StatusCode, nil
}
