package client_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/shepherdjerred/terraform-provider-asuswrt/internal/client"
)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	mux := http.NewServeMux()

	mux.HandleFunc("POST /login.cgi", func(w http.ResponseWriter, r *http.Request) {
		auth := r.FormValue("login_authorization")
		if auth == "" {
			writeJSON(t, w, map[string]string{"error_status": "2"})

			return
		}

		writeJSON(t, w, map[string]string{"asus_token": "test-token-123"})
	})

	mux.HandleFunc("POST /appGet.cgi", func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("asus_token")
		if err != nil || cookie.Value != "test-token-123" {
			writeJSON(t, w, map[string]string{"error_status": "2"})

			return
		}

		hook := r.FormValue("hook")
		result := map[string]string{}

		for _, h := range strings.Split(hook, ";") {
			h = strings.TrimSpace(h)
			if strings.HasPrefix(h, "nvram_get(") && strings.HasSuffix(h, ")") {
				key := h[len("nvram_get(") : len(h)-1]
				result[key] = "test_value_" + key
			}
		}

		writeJSON(t, w, result)
	})

	mux.HandleFunc("POST /apply.cgi", func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("asus_token")
		if err != nil || cookie.Value != "test-token-123" {
			writeJSON(t, w, map[string]string{"error_status": "2"})

			return
		}

		actionMode := r.FormValue("action_mode")
		if actionMode != "apply" {
			writeJSON(t, w, map[string]string{"modify": "0"})

			return
		}

		resp := map[string]string{"modify": "1"}
		if svc := r.FormValue("rc_service"); svc != "" {
			resp["run_service"] = svc
		}

		writeJSON(t, w, resp)
	})

	return httptest.NewServer(mux)
}

func writeJSON(t *testing.T, w http.ResponseWriter, v any) {
	t.Helper()

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(v); err != nil {
		t.Fatalf("encoding JSON response: %v", err)
	}
}

func clientFromServer(t *testing.T, server *httptest.Server) *client.Client {
	t.Helper()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parsing server URL: %v", err)
	}

	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parsing server port: %v", err)
	}

	return client.New(client.Config{
		Host:     u.Hostname(),
		Username: "admin",
		Password: "password",
		Port:     port,
	})
}

func TestClientLogin(t *testing.T) {
	t.Parallel()

	server := newTestServer(t)
	defer server.Close()

	c := clientFromServer(t, server)

	result, err := c.NvramGet(context.Background(), []string{"computer_name"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["computer_name"] != "test_value_computer_name" {
		t.Errorf("expected test_value_computer_name, got %s", result["computer_name"])
	}
}

func TestClientNvramGetMultiple(t *testing.T) {
	t.Parallel()

	server := newTestServer(t)
	defer server.Close()

	c := clientFromServer(t, server)

	keys := []string{"computer_name", "time_zone", "ntp_server0"}

	result, err := c.NvramGet(context.Background(), keys)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	for _, key := range keys {
		expected := "test_value_" + key
		if result[key] != expected {
			t.Errorf("key %s: expected %s, got %s", key, expected, result[key])
		}
	}
}

func TestClientNvramSet(t *testing.T) {
	t.Parallel()

	server := newTestServer(t)
	defer server.Close()

	c := clientFromServer(t, server)

	err := c.NvramSet(context.Background(), map[string]string{
		"computer_name": "NewRouter",
		"time_zone":     "PST8PDT",
	}, "restart_time")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestClientNvramSetNoService(t *testing.T) {
	t.Parallel()

	server := newTestServer(t)
	defer server.Close()

	c := clientFromServer(t, server)

	err := c.NvramSet(context.Background(), map[string]string{
		"computer_name": "TestRouter",
	}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestClientLoginFailure(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /login.cgi", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]string{"error_status": "2"})
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parsing server URL: %v", err)
	}

	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parsing server port: %v", err)
	}

	c := client.New(client.Config{
		Host:     u.Hostname(),
		Username: "admin",
		Password: "wrong",
		Port:     port,
	})

	_, err = c.NvramGet(context.Background(), []string{"computer_name"})
	if err == nil {
		t.Fatal("expected error for bad credentials")
	}
}

func TestClientTokenReauthOnExpiry(t *testing.T) {
	t.Parallel()

	var appGetCalls atomic.Int32

	mux := http.NewServeMux()

	mux.HandleFunc("POST /login.cgi", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]string{"asus_token": "token-" + strconv.Itoa(int(appGetCalls.Load()))})
	})

	mux.HandleFunc("POST /appGet.cgi", func(w http.ResponseWriter, r *http.Request) {
		n := appGetCalls.Add(1)
		if n == 1 {
			writeJSON(t, w, map[string]string{"error_status": "2"})

			return
		}

		hook := r.FormValue("hook")
		result := map[string]string{}

		for _, h := range strings.Split(hook, ";") {
			h = strings.TrimSpace(h)
			if strings.HasPrefix(h, "nvram_get(") && strings.HasSuffix(h, ")") {
				key := h[len("nvram_get(") : len(h)-1]
				result[key] = "value_" + key
			}
		}

		writeJSON(t, w, result)
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	c := clientFromServer(t, server)

	result, err := c.NvramGet(context.Background(), []string{"test_key"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["test_key"] != "value_test_key" {
		t.Errorf("expected value_test_key, got %s", result["test_key"])
	}
}

func TestClientInsecureTLS(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("POST /login.cgi", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]string{"asus_token": "tls-token"})
	})

	mux.HandleFunc("POST /appGet.cgi", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]string{"computer_name": "router"})
	})

	server := httptest.NewTLSServer(mux)
	defer server.Close()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parsing server URL: %v", err)
	}

	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("parsing server port: %v", err)
	}

	c := client.New(client.Config{
		Host: u.Hostname(), Username: "admin", Password: "pass",
		Port: port, HTTPS: true, Insecure: true,
	})

	result, err := c.NvramGet(context.Background(), []string{"computer_name"})
	if err != nil {
		t.Fatalf("unexpected error with insecure TLS: %v", err)
	}

	if result["computer_name"] != "router" {
		t.Errorf("expected router, got %s", result["computer_name"])
	}
}

func TestClientLoginResponseMalformedJSON(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /login.cgi", func(w http.ResponseWriter, _ *http.Request) {
		if _, err := w.Write([]byte("<html>Error</html>")); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	c := clientFromServer(t, server)

	_, err := c.NvramGet(context.Background(), []string{"key"})
	if err == nil {
		t.Fatal("expected error for malformed JSON")
	}

	if !strings.Contains(err.Error(), "parsing login response") {
		t.Errorf("expected 'parsing login response' in error, got: %v", err)
	}
}

func TestClientLoginResponseNoToken(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /login.cgi", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]string{"some_key": "some_value"})
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	c := clientFromServer(t, server)

	_, err := c.NvramGet(context.Background(), []string{"key"})
	if err == nil {
		t.Fatal("expected error for missing token")
	}

	if !errors.Is(err, client.ErrAuth) {
		t.Errorf("expected ErrAuth, got: %v", err)
	}
}

func TestClientNvramGetMalformedJSON(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("POST /login.cgi", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]string{"asus_token": "tok"})
	})

	mux.HandleFunc("POST /appGet.cgi", func(w http.ResponseWriter, _ *http.Request) {
		if _, err := w.Write([]byte("not json")); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	c := clientFromServer(t, server)

	_, err := c.NvramGet(context.Background(), []string{"key"})
	if err == nil {
		t.Fatal("expected error for malformed nvram response")
	}
}

func TestClientNvramSetMalformedJSON(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("POST /login.cgi", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]string{"asus_token": "tok"})
	})

	mux.HandleFunc("POST /apply.cgi", func(w http.ResponseWriter, _ *http.Request) {
		if _, err := w.Write([]byte("not json")); err != nil {
			t.Errorf("writing response: %v", err)
		}
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	c := clientFromServer(t, server)

	err := c.NvramSet(context.Background(), map[string]string{"k": "v"}, "")
	if err == nil {
		t.Fatal("expected error for malformed apply response")
	}
}

func TestClientNvramGetSingleMissingKey(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()

	mux.HandleFunc("POST /login.cgi", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]string{"asus_token": "tok"})
	})

	mux.HandleFunc("POST /appGet.cgi", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(t, w, map[string]string{})
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	c := clientFromServer(t, server)

	val, err := c.NvramGetSingle(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if val != "" {
		t.Errorf("expected empty string, got %q", val)
	}
}
