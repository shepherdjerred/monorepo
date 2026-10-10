package caddys3proxy

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	caddy "github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestConditionalResponse(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotModified)
	}))
	defer backend.Close()
	sess := session.Must(session.NewSession(&aws.Config{Endpoint: aws.String(backend.URL), Region: aws.String("test"), S3ForcePathStyle: aws.Bool(true), Credentials: credentials.AnonymousCredentials}))
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		for _, path := range []string{"/robots.txt", "/"} {
			t.Run(method+path, func(t *testing.T) {
				core, logs := observer.New(zap.DebugLevel)
				proxy := S3Proxy{Bucket: "test", client: s3.New(sess), log: zap.New(core), IndexNames: []string{"index.html"}}
				req := httptest.NewRequest(method, path, nil)
				req = req.WithContext(context.WithValue(req.Context(), caddy.ReplacerCtxKey, caddy.NewReplacer()))
				req.Header.Set("If-None-Match", "\"cached\"")
				writer := httptest.NewRecorder()
				err := proxy.ServeHTTP(writer, req, caddyhttp.HandlerFunc(func(http.ResponseWriter, *http.Request) error { t.Fatal("unexpected next handler"); return nil }))
				if err != nil || writer.Code != http.StatusNotModified || writer.Body.Len() != 0 || logs.FilterLevelExact(zap.ErrorLevel).Len() != 0 {
					t.Fatalf("status=%d bytes=%d err=%v errorLogs=%v", writer.Code, writer.Body.Len(), err, logs.All())
				}
			})
		}
	}
}

// Exercise real HTTP framing: a recorder does not expose chunked responses
// that lose their length while passing through the public serving stack.
func TestArchiveResponseLength(t *testing.T) {
	for _, partial := range []bool{false, true} {
		name := "full"
		payload := strings.Repeat("archive", 1024)
		status := http.StatusOK
		var contentRange *string
		if partial {
			name = "range"
			payload = payload[:16]
			status = http.StatusPartialContent
			contentRange = aws.String("bytes 0-15/7168")
		}
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				obj := &s3.GetObjectOutput{
					Body:          io.NopCloser(strings.NewReader(payload)),
					ContentLength: aws.Int64(int64(len(payload))),
					ContentRange:  contentRange,
					Metadata:      map[string]*string{"Content-Length": aws.String("99999")},
				}
				if err := (S3Proxy{}).writeResponseFromGetObject(w, obj); err != nil {
					t.Errorf("stream response: %v", err)
				}
			}))
			defer server.Close()
			response, err := http.Get(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != status || response.ContentLength != int64(len(payload)) || string(body) != payload {
				t.Fatalf("status=%d length=%d bytes=%d", response.StatusCode, response.ContentLength, len(body))
			}
			if partial && response.Header.Get("Content-Range") != *contentRange {
				t.Fatal("missing or incorrect Content-Range")
			}
		})
	}
}
