package client

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// ErrAuth indicates an authentication failure.
var ErrAuth = errors.New("authentication failed")

// Config holds the configuration for connecting to a router.
type Config struct {
	Host     string
	Username string
	Password string
	HTTPS    bool
	Port     int
	Insecure bool
}

// Client communicates with the Asuswrt-Merlin HTTP API.
type Client struct {
	config     Config
	httpClient *http.Client
	token      string
	baseURL    string
	mu         sync.Mutex
}

// New creates a new Client from the given config.
func New(cfg Config) *Client {
	scheme := "http"
	if cfg.HTTPS {
		scheme = "https"
	}

	port := cfg.Port
	if port == 0 {
		if cfg.HTTPS {
			port = 8443
		} else {
			port = 80
		}
	}

	transport := &http.Transport{}
	if cfg.Insecure {
		transport.TLSClientConfig = &tls.Config{
			MinVersion:         tls.VersionTLS12,
			InsecureSkipVerify: true, //nolint:gosec // user opted in via insecure=true
		}
	}

	return &Client{
		config:     cfg,
		httpClient: &http.Client{Transport: transport},
		baseURL:    fmt.Sprintf("%s://%s:%d", scheme, cfg.Host, port),
	}
}

// login authenticates against /login.cgi and stores the asus_token.
func (c *Client) login(ctx context.Context) error {
	creds := base64.StdEncoding.EncodeToString(
		[]byte(c.config.Username + ":" + c.config.Password),
	)

	form := url.Values{}
	form.Set("login_authorization", creds)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/login.cgi", strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("creating login request: %w", err)
	}

	c.setCommonHeaders(req)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("executing login request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading login response: %w", err)
	}

	var result map[string]string
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("parsing login response: %w", err)
	}

	if errStatus, ok := result["error_status"]; ok && errStatus != "0" {
		return fmt.Errorf("%w: error_status=%s", ErrAuth, errStatus)
	}

	token, ok := result["asus_token"]
	if !ok || token == "" {
		return fmt.Errorf("%w: no token in response", ErrAuth)
	}

	c.token = token
	tflog.Debug(ctx, "authenticated with router")

	return nil
}

// doRequest performs an authenticated HTTP request with automatic re-auth on token expiry.
func (c *Client) doRequest(ctx context.Context, path string, form url.Values) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.token == "" {
		if err := c.login(ctx); err != nil {
			return nil, err
		}
	}

	body, err := c.executeRequest(ctx, path, form)
	if err != nil {
		return nil, err
	}

	if isAuthError(body) {
		tflog.Debug(ctx, "token expired, re-authenticating")

		if err := c.login(ctx); err != nil {
			return nil, err
		}

		return c.executeRequest(ctx, path, form)
	}

	return body, nil
}

// executeRequest sends a single POST request with the current token.
func (c *Client) executeRequest(ctx context.Context, path string, form url.Values) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("creating request for %s: %w", path, err)
	}

	c.setCommonHeaders(req)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: "asus_token", Value: c.token})

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("executing request to %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response from %s: %w", path, err)
	}

	return body, nil
}

// isAuthError checks if a response body indicates an authentication error.
func isAuthError(body []byte) bool {
	var result map[string]string
	if json.Unmarshal(body, &result) != nil {
		return false
	}

	errStatus, ok := result["error_status"]

	return ok && errStatus != "0"
}

// setCommonHeaders adds the required Referer, Origin, and User-Agent headers.
func (c *Client) setCommonHeaders(req *http.Request) {
	req.Header.Set("Referer", c.baseURL+"/")
	req.Header.Set("Origin", c.baseURL)
	req.Header.Set("User-Agent", "asusrouter--DUTUtil-0.2")
}
