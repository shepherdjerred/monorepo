package plugin

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	cloud "github.com/openebs/velero-plugin/pkg/clouduploader"
	"github.com/sirupsen/logrus"
)

func TestCompletedTransferKeepsFailureAndNativePrecedence(t *testing.T) {
	native := errors.New("native-error")
	for _, tc := range []struct {
		name      string
		completed bool
		native    error
		wantError bool
	}{
		{"full-eof-success", true, nil, false},
		{"cloud-failure", false, nil, true},
		{"native-error-preserved", false, native, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var wg sync.WaitGroup
			wg.Add(1)
			completed := make(chan bool, 1)
			startup := make(chan bool, 1)
			startup <- true
			<-startup
			go func() {
				defer wg.Done()
				completed <- tc.completed
				if !tc.completed {
					startup <- false
				}
				close(startup)
			}()
			done := make(chan error, 1)
			go func() { done <- completedTransfer(&wg, completed, tc.native) }()
			select {
			case err := <-done:
				if (err != nil) != tc.wantError {
					t.Fatal("wrong completion result")
				}
				if tc.native != nil && err != tc.native {
					t.Fatal("native error replaced")
				}
			case <-time.After(2 * time.Second):
				t.Fatal("startup/completion deadlock")
			}
		})
	}
}

func TestActualPostReadyDownloadFailureDoesNotBlockStartupChannel(t *testing.T) {
	for k, v := range map[string]string{"AWS_ACCESS_KEY_ID": "unit-test-only", "AWS_SECRET_ACCESS_KEY": "unit-test-only", "AWS_SESSION_TOKEN": "", "AWS_PROFILE": "", "AWS_DEFAULT_PROFILE": "", "AWS_CONFIG_FILE": "/dev/null", "AWS_SHARED_CREDENTIALS_FILE": "/dev/null", "AWS_EC2_METADATA_DISABLED": "true"} {
		t.Setenv(k, v)
	}
	objectServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(404)
		io.WriteString(w, "<Error><Code>NoSuchKey</Code></Error>")
	}))
	defer objectServer.Close()
	log := logrus.New()
	log.SetOutput(io.Discard)
	connection := &cloud.Conn{Log: log}
	if err := connection.Init(map[string]string{"provider": "aws", "bucket": "unit-test", "region": "us-east-1", "s3Url": objectServer.URL, "s3ForcePathStyle": "true", "DisableSSL": "true"}); err != nil {
		t.Fatal("synthetic local S3 setup failed")
	}
	connection.ConnStateReset()
	p := &Plugin{Log: log, cl: connection}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	var wg sync.WaitGroup
	wg.Add(1)
	completed := make(chan bool, 1)
	go p.doDownload(&wg, "unit-stream", port, completed)
	select {
	case ok := <-*connection.ConnReady:
		if !ok {
			t.Fatal("server not ready")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("startup blocked")
	}
	peer, err := net.Dial("tcp", net.JoinHostPort("127.0.0.1", fmt.Sprint(port)))
	if err != nil {
		t.Fatal(err)
	}
	peer.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := io.Copy(io.Discard, peer); err != nil {
		t.Fatal("server did not close failed transfer")
	}
	peer.Close()
	connection.ExitServer = true
	done := make(chan error, 1)
	go func() { done <- completedTransfer(&wg, completed, nil) }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("actual post-ready failure hidden")
		}
	case <-time.After(8 * time.Second):
		t.Fatal("post-ready failure blocked on startup channel")
	}
	if _, open := <-*connection.ConnReady; open {
		t.Fatal("startup channel not closed")
	}
}

func TestFailedTransferCannotPublishChainManifest(t *testing.T) {
	var wg sync.WaitGroup
	completed := make(chan bool, 1)
	completed <- false
	published := false
	err := publishCompletedTransfer(&wg, completed, func() error { published = true; return nil })
	if err == nil || published {
		t.Fatal("failed transfer reached manifest publication")
	}
}
