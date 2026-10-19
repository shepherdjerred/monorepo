package clouduploader

import (
	"fmt"
	"io"
	"syscall"
)

// Error strings intentionally contain only fixed classes and concrete Go types.
type cloudStreamError struct {
	kind  string
	cause error
}

func (e *cloudStreamError) Error() string {
	return fmt.Sprintf("cloud-stream %s (%s)", e.kind, safeErrorType(e.cause))
}
func (e *cloudStreamError) Unwrap() error { return e.cause }
func safeErrorType(err error) string {
	if err == nil {
		return "none"
	}
	return fmt.Sprintf("%T", err)
}
func safeErrorKind(err error) string {
	if e, ok := err.(*cloudStreamError); ok {
		return e.kind
	}
	if err == nil {
		return "none"
	}
	return "other"
}
func streamFailure(kind string, err error) error { return &cloudStreamError{kind, err} }

func (s *Server) restoreRead(c *Client, reader io.Reader, expected int64) error {
	c.expectedBytes = expected
	n, readErr := reader.Read(c.buffer)
	if n < 0 || n > len(c.buffer) {
		return streamFailure("invalid-read-count", nil)
	}
	if n > 0 {
		c.readBytes += int64(n)
		if c.readBytes > expected {
			return streamFailure("excess-cloud-bytes", nil)
		}
		if sendErr := s.SendData(c, n); sendErr != nil {
			return sendErr
		}
	}
	if readErr == io.EOF {
		if c.readBytes != expected || c.sentBytes != expected {
			return streamFailure("early-eof", io.ErrUnexpectedEOF)
		}
		c.status = TransferStatusDone
		return io.EOF
	}
	if readErr != nil {
		return streamFailure("cloud-read", readErr)
	}
	// (0,nil) is no progress, never EOF/completion. Level-triggered OUT retries.
	return nil
}

// Always drain backup input before handling HUP. RDHUP on a restore is only the
// peer's unused sending half; it does not mean its receiving half has closed.
func (s *Server) dispatchClientEvent(event syscall.EpollEvent, epfd int) {
	c := s.getClientFromEvent(event)
	if c.closed {
		return
	}
	var err error
	if s.OpType == OpBackup && event.Events&(syscall.EPOLLIN|syscall.EPOLLHUP|syscall.EPOLLRDHUP) != 0 {
		err = s.handleRead(event)
	}
	if s.OpType == OpRestore && event.Events&syscall.EPOLLOUT != 0 {
		err = s.handleWrite(event)
	}
	if err == nil && event.Events&(syscall.EPOLLHUP|syscall.EPOLLERR) != 0 && c.status != TransferStatusDone {
		err = streamFailure("socket-hangup", nil)
	}
	if err != nil || c.status == TransferStatusDone {
		s.handleClientError(err, event, epfd)
	}
}
