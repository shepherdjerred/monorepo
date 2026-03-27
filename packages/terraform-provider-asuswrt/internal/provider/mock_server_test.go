package provider_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// mockRouter simulates an Asuswrt-Merlin router HTTP API for acceptance tests.
type mockRouter struct {
	mu    sync.Mutex
	nvram map[string]string
}

func newMockRouter() *mockRouter {
	return &mockRouter{
		nvram: make(map[string]string),
	}
}

func (m *mockRouter) handler(t *testing.T) http.Handler {
	t.Helper()
	mux := http.NewServeMux()

	mux.HandleFunc("POST /login.cgi", func(w http.ResponseWriter, r *http.Request) {
		auth := r.FormValue("login_authorization") //nolint:gosec // test server, no DoS risk
		if auth == "" {
			writeTestJSON(t, w, map[string]string{"error_status": "2"})
			return
		}
		writeTestJSON(t, w, map[string]string{"asus_token": "mock-token"})
	})

	mux.HandleFunc("POST /appGet.cgi", func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("asus_token")
		if err != nil || cookie.Value != "mock-token" {
			writeTestJSON(t, w, map[string]string{"error_status": "2"})
			return
		}
		hook := r.FormValue("hook") //nolint:gosec // test server, no DoS risk
		result := map[string]string{}
		m.mu.Lock()
		for _, h := range strings.Split(hook, ";") {
			h = strings.TrimSpace(h)
			if strings.HasPrefix(h, "nvram_get(") && strings.HasSuffix(h, ")") {
				key := h[len("nvram_get(") : len(h)-1]
				result[key] = m.nvram[key] // returns "" for missing keys, which is correct
			}
		}
		m.mu.Unlock()
		writeTestJSON(t, w, result)
	})

	mux.HandleFunc("POST /apply.cgi", func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("asus_token")
		if err != nil || cookie.Value != "mock-token" {
			writeTestJSON(t, w, map[string]string{"error_status": "2"})
			return
		}
		if err := r.ParseForm(); err != nil { //nolint:gosec // test server, no DoS risk
			t.Errorf("parsing form: %v", err)
			return
		}
		m.mu.Lock()
		for k, vals := range r.PostForm {
			if k == "action_mode" || k == "rc_service" {
				continue
			}
			m.nvram[k] = vals[0]
		}
		m.mu.Unlock()
		writeTestJSON(t, w, map[string]string{"modify": "1"})
	})

	return mux
}

func writeTestJSON(t *testing.T, w http.ResponseWriter, v any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		t.Fatalf("encoding JSON: %v", err)
	}
}

func startMockServer(t *testing.T, router *mockRouter) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(router.handler(t))
	t.Cleanup(server.Close)
	return server
}

func providerConfig(serverURL string) string {
	u, _ := url.Parse(serverURL)
	return `
provider "asuswrt" {
  host     = "` + u.Hostname() + `"
  username = "admin"
  password = "password"
  port     = ` + u.Port() + `
}
`
}
