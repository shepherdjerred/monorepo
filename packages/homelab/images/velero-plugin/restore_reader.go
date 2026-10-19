package clouduploader

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/service/s3"
	"gocloud.dev/blob"
)

// A reopen is deferred until the caller has forwarded the preceding Read's n
// bytes. Socket failures therefore never initiate a cloud retry or replay bytes.
type rangeRestoreReader struct {
	reader       *blob.Reader
	open         func(int64) (*blob.Reader, error)
	size, offset int64
	pending      error
	retries      int
	closed       bool
}

func (c *Conn) newRestoreReader() (*rangeRestoreReader, error) {
	if c.provider == GCP { // Preserve the existing, non-resuming GCP contract.
		r, err := c.bucket.NewReader(c.ctx, c.file, nil)
		if err != nil {
			return nil, err
		}
		return &rangeRestoreReader{reader: r, size: r.Size()}, nil
	}
	return newS3RestoreReader(c.ctx, c.bucket, c.file)
}

func newS3RestoreReader(ctx context.Context, bucket *blob.Bucket, key string) (*rangeRestoreReader, error) {
	attrs, err := bucket.Attributes(ctx, key)
	if err != nil {
		return nil, err
	}
	var head s3.HeadObjectOutput
	if !attrs.As(&head) || aws.StringValue(head.ETag) == "" || attrs.Size < 0 {
		return nil, streamFailure("cloud-object-identity", nil)
	}
	etag, size := aws.StringValue(head.ETag), attrs.Size
	result := &rangeRestoreReader{size: size}
	result.open = func(offset int64) (*blob.Reader, error) {
		r, err := bucket.NewRangeReader(ctx, key, offset, -1, &blob.ReaderOptions{BeforeRead: func(as func(interface{}) bool) error {
			var request *s3.GetObjectInput
			if !as(&request) {
				return streamFailure("cloud-object-request", nil)
			}
			request.IfMatch = aws.String(etag)
			return nil
		}})
		if err != nil {
			return nil, err
		}
		var response s3.GetObjectOutput
		valid := r.As(&response) && aws.StringValue(response.ETag) == etag && r.Size() == size && aws.Int64Value(response.ContentLength) == size-offset
		if offset > 0 {
			valid = valid && aws.StringValue(response.ContentRange) == fmt.Sprintf("bytes %d-%d/%d", offset, size-1, size)
		} else {
			valid = valid && (aws.StringValue(response.ContentRange) == "" || aws.StringValue(response.ContentRange) == fmt.Sprintf("bytes 0-%d/%d", size-1, size))
		}
		if !valid {
			if closeErr := r.Close(); closeErr != nil {
				return nil, streamFailure("cloud-close", closeErr)
			}
			return nil, streamFailure("cloud-object-changed", nil)
		}
		return r, nil
	}
	result.reader, err = result.open(0)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func retryRestoreRead(err error) bool {
	// Neither authorization nor cancellation nor a permanent response may be
	// hidden by a nested transport error. Only concrete mid-body interruptions.
	status, provider, transport := safeProviderFailure(err)
	return status == 0 && (provider == "none" || provider == "NetworkingError") && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) &&
		(transport == "unexpected-eof" || transport == "connection-reset")
}

func (r *rangeRestoreReader) canResume(err error) bool {
	return r.open != nil && retryRestoreRead(err) && r.offset > 0 && r.offset < r.size && r.retries < 3
}

func (r *rangeRestoreReader) Read(p []byte) (int, error) {
	if r.pending != nil {
		err := r.pending
		if !r.canResume(err) {
			return 0, err
		}
		if closeErr := r.reader.Close(); closeErr != nil {
			r.closed = true
			return 0, streamFailure("cloud-close", closeErr)
		}
		r.closed = true
		r.retries++
		next, openErr := r.open(r.offset)
		if openErr != nil {
			return 0, openErr
		}
		r.reader, r.closed, r.pending = next, false, nil
	}
	n, err := r.reader.Read(p)
	if n < 0 || n > len(p) {
		return 0, streamFailure("invalid-read-count", nil)
	}
	r.offset += int64(n)
	if err != nil && err != io.EOF {
		r.pending = err
		if n > 0 && r.canResume(err) {
			return n, nil
		}
		// Do not recurse or spin inside one readiness event. The next event
		// applies the same bounded retry; permanent errors remain immediate.
		if r.canResume(err) {
			return 0, nil
		}
	}
	return n, err
}

func (r *rangeRestoreReader) Size() int64 { return r.size }
func (r *rangeRestoreReader) Close() error {
	if r.closed {
		return nil
	}
	r.closed = true
	return r.reader.Close()
}
