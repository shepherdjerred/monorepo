package caddys3proxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/s3"
)

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
