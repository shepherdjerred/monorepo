package clouduploader

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"syscall"
	"testing"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/awserr"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"gocloud.dev/blob"
	"gocloud.dev/blob/s3blob"
)

type restoreTransport func(*http.Request) (*http.Response, error)

func (f restoreTransport) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

type restoreInterruptedBody struct {
	io.ReadCloser
	closeFailure bool
	interrupted  bool
}

func (b *restoreInterruptedBody) Read(p []byte) (int, error) {
	if !b.interrupted {
		b.interrupted = true
		n, _ := io.ReadFull(b.ReadCloser, p[:312])
		return n, io.ErrUnexpectedEOF
	}
	return b.ReadCloser.Read(p)
}
func (b *restoreInterruptedBody) Close() error {
	err := b.ReadCloser.Close()
	if err == nil && b.closeFailure {
		return errors.New("fixture close failure")
	}
	return err
}

// Real pinned S3 transport: a positive body prefix followed by a closed HTTP
// connection produces the actual GoCloud-wrapped UnexpectedEOF from production.
func s3RestoreFixture(t *testing.T, mode string) (*rangeRestoreReader, *[]string) {
	t.Helper()
	data := strings.Repeat("abcdefgh", 256)
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("ETag", `"immutable"`)
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		if request.Method == http.MethodHead {
			return
		}
		if request.Header.Get("If-Match") != `"immutable"` {
			t.Error("GET was not conditional on the frozen HEAD identity")
		}
		rangeHeader := request.Header.Get("Range")
		requests = append(requests, rangeHeader)
		offset := 0
		if rangeHeader != "" {
			if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-", &offset); err != nil {
				t.Error("invalid Range")
			}
			w.Header().Set("Content-Length", strconv.Itoa(len(data)-offset))
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, len(data)-1, len(data)))
			if mode == "etag" {
				w.Header().Set("ETag", `"changed"`)
			}
			if mode == "range" {
				w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-%d/%d", len(data)-1, len(data)))
			}
			if mode == "size" {
				w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, len(data)-1, len(data)+1))
			}
			if mode == "denied" {
				w.Header().Del("Content-Length")
				w.WriteHeader(http.StatusPreconditionFailed)
				return
			}
			w.WriteHeader(http.StatusPartialContent)
		}
		if len(requests) == 1 || mode == "exhaust" {
			w.Write([]byte(data[offset : offset+312]))
			w.(http.Flusher).Flush()
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error("fixture hijack failed")
				return
			}
			conn.Close()
			return
		}
		w.Write([]byte(data[offset:]))
	}))
	t.Cleanup(server.Close)
	client := &http.Client{Transport: restoreTransport(func(request *http.Request) (*http.Response, error) {
		response, err := http.DefaultTransport.RoundTrip(request)
		if err == nil && request.Method == http.MethodGet && request.Header.Get("Range") == "" && (mode == "n-error" || mode == "close") {
			response.Body = &restoreInterruptedBody{ReadCloser: response.Body, closeFailure: mode == "close"}
		}
		return response, err
	})}
	sess := session.Must(session.NewSession(aws.NewConfig().WithHTTPClient(client).WithRegion("fixture").WithEndpoint(server.URL).WithS3ForcePathStyle(true).WithMaxRetries(0).WithCredentials(credentials.NewStaticCredentials("fixture", "fixture", ""))))
	bucket, err := s3blob.OpenBucket(context.Background(), sess, "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { bucket.Close() })
	r, err := newS3RestoreReader(context.Background(), bucket, "stream")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return r, &requests
}

func driveRestore(t *testing.T, r *rangeRestoreReader) (*Client, []byte, error) {
	t.Helper()
	c, peer := socketClient(t)
	s := &Server{OpType: OpRestore, Log: streamLogger()}
	var err error
	for i := 0; i < 30 && err == nil; i++ {
		err = s.restoreRead(c, r, r.Size())
	}
	syscall.Shutdown(c.fd, syscall.SHUT_WR)
	var got bytes.Buffer
	buffer := make([]byte, 4096)
	for {
		n, e := syscall.Read(peer, buffer)
		if n > 0 {
			got.Write(buffer[:n])
		}
		if e != nil || n == 0 {
			break
		}
	}
	return c, got.Bytes(), err
}

func TestS3RestoreResumesExactImmutableRangeAfterRealHTTPTruncation(t *testing.T) {
	for _, mode := range []string{"success", "n-error"} {
		t.Run(mode, func(t *testing.T) {
			r, requests := s3RestoreFixture(t, mode)
			c, got, err := driveRestore(t, r)
			if err != io.EOF || c.status != TransferStatusDone || string(got) != strings.Repeat("abcdefgh", 256) || c.readBytes != 2048 || c.sentBytes != 2048 {
				t.Fatalf("conditional range restore failed: kind=%s read=%d sent=%d", safeErrorKind(err), c.readBytes, c.sentBytes)
			}
			if fmt.Sprint(*requests) != "[ bytes=312-]" {
				t.Fatal("resume duplicated or skipped a prefix")
			}
		})
	}
}

func TestS3RestoreRefusesChangedIdentityWrongRangeAndExhaustion(t *testing.T) {
	for _, mode := range []string{"etag", "range", "size", "denied", "exhaust"} {
		t.Run(mode, func(t *testing.T) {
			r, requests := s3RestoreFixture(t, mode)
			c, _, err := driveRestore(t, r)
			if err == nil || err == io.EOF || c.status == TransferStatusDone {
				t.Fatal("invalid or exhausted resume completed")
			}
			if mode == "exhaust" && (len(*requests) != 4 || c.sentBytes != 1248) {
				t.Fatal("resume budget not bounded")
			}
			if mode != "exhaust" && (len(*requests) != 2 || c.sentBytes != 312) {
				t.Fatal("changed object bytes reached receiver")
			}
		})
	}
}

func TestRestoreResumeNeverRetriesPermanentOrSizeBoundaryErrors(t *testing.T) {
	for _, err := range []error{context.Canceled, context.DeadlineExceeded, errors.New("permanent"), syscall.EPIPE, syscall.ECONNREFUSED, awserr.New("AccessDenied", "private", syscall.ECONNRESET)} {
		if retryRestoreRead(err) {
			t.Fatal("permanent error classified retryable")
		}
	}
	for _, offset := range []int64{0, 8, 9} {
		r := &rangeRestoreReader{size: 8, offset: offset, pending: io.ErrUnexpectedEOF, open: func(int64) (*blob.Reader, error) { t.Fatal("size boundary reopened"); return nil, nil }}
		if _, err := r.Read(make([]byte, 8)); !errors.Is(err, io.ErrUnexpectedEOF) {
			t.Fatal("size boundary error lost")
		}
	}
}

func TestS3RestoreCloseAndSocketFailuresNeverReopen(t *testing.T) {
	t.Run("close", func(t *testing.T) {
		r, requests := s3RestoreFixture(t, "close")
		c, _, err := driveRestore(t, r)
		if err == nil || c.status == TransferStatusDone || len(*requests) != 1 || !strings.Contains(err.Error(), "cloud-close") {
			t.Fatal("Close failure was retried or lost")
		}
	})
	t.Run("socket", func(t *testing.T) {
		r, requests := s3RestoreFixture(t, "n-error")
		c, peer := socketClient(t)
		syscall.Shutdown(peer, syscall.SHUT_RD)
		err := (&Server{OpType: OpRestore}).restoreRead(c, r, r.Size())
		if err == nil || safeErrorKind(err) != "socket-write" || len(*requests) != 1 || r.retries != 0 {
			t.Fatal("socket failure resumed cloud read")
		}
	})
}
