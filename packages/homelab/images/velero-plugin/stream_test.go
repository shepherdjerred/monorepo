package clouduploader

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go/aws/awserr"
	"github.com/sirupsen/logrus"
	"gocloud.dev/blob"
	"gocloud.dev/blob/driver"
	"gocloud.dev/blob/memblob"
	"gocloud.dev/gcerrors"
)

type failingProviderBucket struct {
	driver.Bucket
	cause error
}

func (b *failingProviderBucket) NewTypedWriter(context.Context, string, string, *driver.WriterOptions) (driver.Writer, error) {
	return nil, b.cause
}
func (b *failingProviderBucket) ErrorCode(error) gcerrors.ErrorCode { return gcerrors.Unknown }

func TestProviderFailureDiagnosticsUseActualGoCloudAndNestedAWSCause(t *testing.T) {
	private := "private-token https://private-endpoint/object-key request-id"
	request := awserr.NewRequestFailure(awserr.New("ServiceUnavailable", private, nil), 503, private)
	aws := awserr.New("MultipartUploadFailure", private, request)
	bucket := blob.NewBucket(&failingProviderBucket{cause: aws})
	writer, err := bucket.NewWriter(context.Background(), "private-key", &blob.WriterOptions{ContentType: "application/octet-stream"})
	if err == nil {
		_, err = writer.Write([]byte("private-world-data"))
	}
	if err == nil {
		t.Fatal("expected real GoCloud writer failure")
	}
	message := streamFailure("cloud-write", err).Error()
	for _, want := range []string{"(*gcerr.Error)", "gcerr=1", "http=503", "aws=ServiceUnavailable"} {
		if !strings.Contains(message, want) {
			t.Fatalf("missing safe provider classification %s", want)
		}
	}
	if strings.Contains(message, "private") || strings.Contains(message, "request-id") {
		t.Fatal("provider diagnostics leaked private error fields")
	}
}

func TestProviderFailureDiagnosticsClassifyTransportWithoutRawMessages(t *testing.T) {
	for _, tc := range []struct {
		cause error
		want  string
	}{
		{&net.OpError{Op: "read", Net: "tcp", Err: syscall.ECONNRESET}, "transport=connection-reset"},
		{io.ErrUnexpectedEOF, "transport=unexpected-eof"},
		{context.DeadlineExceeded, "transport=context-deadline"},
		{awserr.New("private-provider-code", "private-message", context.Canceled), "aws=other transport=context-canceled"},
	} {
		message := streamFailure("cloud-read", fmt.Errorf("private-endpoint: %w", tc.cause)).Error()
		if !strings.Contains(message, tc.want) || strings.Contains(message, "private") {
			t.Fatal("unsafe or missing transport classification")
		}
	}
}

func TestActualGoCloudReaderCleanEOFCompletesStrictRestore(t *testing.T) {
	bucket := memblob.OpenBucket(nil)
	if err := bucket.WriteAll(context.Background(), "fixture", []byte("abc"), nil); err != nil {
		t.Fatal(err)
	}
	reader, err := bucket.NewReader(context.Background(), "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	c, _ := socketClient(t)
	s := &Server{OpType: OpRestore, Log: streamLogger()}
	for i := 0; i < 4 && err == nil; i++ {
		err = s.restoreRead(c, reader, reader.Size())
	}
	if err != io.EOF || c.status != TransferStatusDone || c.readBytes != 3 || c.sentBytes != 3 {
		t.Fatal("real GoCloud EOF was misclassified as cloud-read failure")
	}
}

type restoreStep struct {
	data string
	err  error
}
type restoreReader struct{ steps []restoreStep }

func (r *restoreReader) Read(p []byte) (int, error) {
	if len(r.steps) == 0 {
		return 0, io.EOF
	}
	v := r.steps[0]
	r.steps = r.steps[1:]
	return copy(p, v.data), v.err
}
func streamLogger() *logrus.Logger { l := logrus.New(); l.SetOutput(io.Discard); return l }

func socketClient(t *testing.T) (*Client, int) {
	t.Helper()
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err != nil {
		t.Fatal(err)
	}
	c := &Client{fd: fds[0], buffer: make([]byte, ReadBufferLen), status: TransferStatusInit}
	t.Cleanup(func() {
		if !c.closed {
			syscall.Close(fds[0])
		}
		syscall.Close(fds[1])
	})
	return c, fds[1]
}

func TestRestoreReadKeepsBytesAndActualErrors(t *testing.T) {
	sentinel := errors.New("private URL must never be formatted")
	for _, tc := range []struct {
		name     string
		steps    []restoreStep
		expected int64
		want     error
		done     bool
		sent     int64
	}{
		{"zero-nil-then-data", []restoreStep{{"", nil}, {"abc", io.EOF}}, 3, io.EOF, true, 3},
		{"final-bytes-eof", []restoreStep{{"abc", io.EOF}}, 3, io.EOF, true, 3},
		{"bytes-with-non-eof", []restoreStep{{"abc", sentinel}}, 3, sentinel, false, 3},
		{"short-eof", []restoreStep{{"ab", io.EOF}}, 3, io.ErrUnexpectedEOF, false, 2},
		{"excess-data", []restoreStep{{"abc", nil}}, 2, nil, false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := socketClient(t)
			s := &Server{OpType: OpRestore, Log: streamLogger()}
			r := &restoreReader{tc.steps}
			var err error
			for range tc.steps {
				err = s.restoreRead(c, r, tc.expected)
				if err != nil {
					break
				}
				if c.status == TransferStatusDone {
					t.Fatal("nil/no-progress marked complete")
				}
			}
			if tc.want != nil && !errors.Is(err, tc.want) {
				t.Fatalf("missing expected error identity: %T", err)
			}
			if tc.name == "excess-data" && err == nil {
				t.Fatal("excess bytes accepted")
			}
			if (c.status == TransferStatusDone) != tc.done || c.sentBytes != tc.sent {
				t.Fatal("incorrect completion/count")
			}
			if err != nil && bytes.Contains([]byte(err.Error()), []byte("private URL")) {
				t.Fatal("raw error text leaked")
			}
		})
	}
}

func TestPartialSocketWritesRetainEveryByte(t *testing.T) {
	c := &Client{buffer: []byte("abcdef")}
	s := &Server{}
	var got []byte
	calls := 0
	err := s.sendData(c, 6, func(p []byte) (int, error) {
		calls++
		if calls == 1 {
			return 0, syscall.EAGAIN
		}
		n := 2
		if len(p) < n {
			n = len(p)
		}
		got = append(got, p[:n]...)
		return n, nil
	})
	if err != nil || string(got) != "abcdef" || c.sentBytes != 6 {
		t.Fatal("partial write lost data")
	}
}

func registeredEvent(t *testing.T, s *Server, c *Client, mask uint32) (syscall.EpollEvent, int) {
	t.Helper()
	epfd, err := syscall.EpollCreate1(0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { syscall.Close(epfd) })
	event := syscall.EpollEvent{Events: mask}
	s.addClientToEvent(c, &event)
	if err := syscall.EpollCtl(epfd, syscall.EPOLL_CTL_ADD, c.fd, &event); err != nil {
		t.Fatal(err)
	}
	s.appendToClientList(c)
	return event, epfd
}

func TestCombinedBackupEventsDrainBeforeClose(t *testing.T) {
	for _, mask := range []uint32{syscall.EPOLLIN | syscall.EPOLLHUP, syscall.EPOLLIN | syscall.EPOLLRDHUP, syscall.EPOLLIN | syscall.EPOLLOUT | syscall.EPOLLHUP} {
		t.Run(fmt.Sprintf("mask-%x", mask), func(t *testing.T) {
			bucket := memblob.OpenBucket(nil)
			defer bucket.Close()
			writer, err := bucket.NewWriter(context.Background(), "stream", nil)
			if err != nil {
				t.Fatal(err)
			}
			c, peer := socketClient(t)
			c.file = ReadWriter(writer)
			s := &Server{OpType: OpBackup, Log: streamLogger(), cl: &Conn{Log: streamLogger()}}
			event, epfd := registeredEvent(t, s, c, mask)
			if _, err := syscall.Write(peer, []byte("final-buffer")); err != nil {
				t.Fatal(err)
			}
			syscall.Shutdown(peer, syscall.SHUT_WR)
			s.dispatchClientEvent(event, epfd)
			got, err := bucket.ReadAll(context.Background(), "stream")
			if err != nil || string(got) != "final-buffer" {
				t.Fatal("combined HUP discarded final bytes")
			}
			if s.state.successCount != 1 || s.state.firstFailure != nil || !c.closed {
				t.Fatal("bad EOF accounting")
			}
		})
	}
}

func TestRestoreHangupCannotManufactureCompletion(t *testing.T) {
	for _, mask := range []uint32{syscall.EPOLLHUP, syscall.EPOLLERR, syscall.EPOLLOUT | syscall.EPOLLHUP} {
		bucket := memblob.OpenBucket(nil)
		data := bytes.Repeat([]byte("x"), ReadBufferLen+1)
		bucket.WriteAll(context.Background(), "stream", data, nil)
		reader, err := bucket.NewReader(context.Background(), "stream", nil)
		if err != nil {
			t.Fatal(err)
		}
		c, _ := socketClient(t)
		c.file = ReadWriter(&rangeRestoreReader{reader: reader, size: reader.Size()})
		s := &Server{OpType: OpRestore, Log: streamLogger(), cl: &Conn{Log: streamLogger()}}
		event, epfd := registeredEvent(t, s, c, mask)
		s.dispatchClientEvent(event, epfd)
		if s.state.successCount != 0 || s.state.failedCount != 1 || s.state.firstFailure == nil {
			t.Fatal("hangup counted as success")
		}
		bucket.Close()
	}
}

func TestCombinedRestoreReadyAndHalfClose(t *testing.T) {
	bucket := memblob.OpenBucket(nil)
	defer bucket.Close()
	bucket.WriteAll(context.Background(), "stream", []byte("abc"), nil)
	reader, err := bucket.NewReader(context.Background(), "stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	c, _ := socketClient(t)
	c.file = ReadWriter(&rangeRestoreReader{reader: reader, size: reader.Size()})
	s := &Server{OpType: OpRestore, Log: streamLogger(), cl: &Conn{Log: streamLogger()}}
	event, epfd := registeredEvent(t, s, c, syscall.EPOLLIN|syscall.EPOLLOUT|syscall.EPOLLRDHUP)
	s.dispatchClientEvent(event, epfd)
	if !c.closed {
		s.dispatchClientEvent(event, epfd)
	}
	if c.sentBytes != 3 || s.state.successCount != 1 || s.state.firstFailure != nil {
		t.Fatal("combined readiness/peer sending half close broke restore")
	}
}

func TestAcceptFailureReachesRunAndUploadCaller(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bucket := memblob.OpenBucket(nil)
	defer bucket.Close()
	ready := make(chan bool, 1)
	cloud := &Conn{Log: streamLogger(), ctx: ctx, bucket: bucket, ConnReady: &ready}
	done := make(chan bool, 1)
	go func() { done <- cloud.Upload("stream", 3, port) }()
	select {
	case ok := <-ready:
		if !ok {
			t.Fatal("not ready")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("listen blocked")
	}
	cancel()
	peer, err := net.Dial("tcp", fmtAddress(port))
	if err != nil {
		t.Fatal(err)
	}
	peer.Write([]byte("abc"))
	peer.(*net.TCPConn).CloseWrite()
	peer.SetReadDeadline(time.Now().Add(2 * time.Second))
	io.Copy(io.Discard, peer)
	peer.Close()
	cloud.ExitServer = true
	select {
	case ok := <-done:
		if ok {
			t.Fatal("cloud failure hidden by Run/Upload")
		}
	case <-time.After(8 * time.Second):
		t.Fatal("Run did not stop")
	}
}

func TestCloudCloseFailureCannotCountSuccessfulBackup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bucket := memblob.OpenBucket(nil)
	defer bucket.Close()
	writer, err := bucket.NewWriter(ctx, "stream", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte("abc")); err != nil {
		t.Fatal(err)
	}
	c, _ := socketClient(t)
	c.file = ReadWriter(writer)
	c.status = TransferStatusDone
	s := &Server{OpType: OpBackup, Log: streamLogger(), cl: &Conn{Log: streamLogger()}}
	event, epfd := registeredEvent(t, s, c, syscall.EPOLLIN)
	cancel()
	s.handleClientError(io.EOF, event, epfd)
	if s.state.successCount != 0 || s.state.failedCount != 1 || safeErrorKind(s.state.firstFailure) != "cloud-close" {
		t.Fatal("failed cloud commit counted as successful backup")
	}
}

func TestBackupBinaryWriterCountsFragmentedHeaderExactly(t *testing.T) {
	bucket := memblob.OpenBucket(nil)
	defer bucket.Close()
	connection := &Conn{Log: streamLogger(), ctx: context.Background(), bucket: bucket, file: "stream"}
	c, peer := socketClient(t)
	if err := syscall.SetNonblock(c.fd, true); err != nil {
		t.Fatal(err)
	}
	c.file = connection.Create(OpBackup)
	if c.file == nil {
		t.Fatal("production writer not created")
	}
	s := &Server{OpType: OpBackup, Log: streamLogger(), cl: connection}
	event, epfd := registeredEvent(t, s, c, syscall.EPOLLIN)
	header := bytes.Repeat([]byte{0}, 312)
	body := bytes.Repeat([]byte{1}, 512)
	if _, err := syscall.Write(peer, header); err != nil {
		t.Fatal(err)
	}
	s.dispatchClientEvent(event, epfd)
	if c.closed {
		t.Fatal("buffered header closed transfer")
	}
	if _, err := syscall.Write(peer, body); err != nil {
		t.Fatal(err)
	}
	syscall.Shutdown(peer, syscall.SHUT_WR)
	event.Events = syscall.EPOLLIN | syscall.EPOLLHUP
	s.dispatchClientEvent(event, epfd)
	if s.state.firstFailure != nil || s.state.successCount != 1 || c.readBytes != 824 {
		t.Fatal("fragmented binary stream miscounted")
	}
	actual, err := bucket.ReadAll(context.Background(), "stream")
	if err != nil || !bytes.Equal(actual, append(header, body...)) {
		t.Fatal("fragmented stream bytes differ")
	}
	attributes, err := bucket.Attributes(context.Background(), "stream")
	if err != nil || attributes.ContentType != "application/octet-stream" {
		t.Fatal("binary stream content type differs")
	}
}

func fmtAddress(port int) string { return net.JoinHostPort("127.0.0.1", fmt.Sprint(port)) }
