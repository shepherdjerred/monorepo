package client_test

import (
	"context"
	"testing"
)

func TestNvramGetSingle(t *testing.T) {
	t.Parallel()

	server := newTestServer(t)
	defer server.Close()

	c := clientFromServer(t, server)

	val, err := c.NvramGetSingle(context.Background(), "computer_name")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "test_value_computer_name"
	if val != expected {
		t.Errorf("expected %s, got %s", expected, val)
	}
}
