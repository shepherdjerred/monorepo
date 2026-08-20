package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/types"
)

func TestClientCRUD(t *testing.T) {
	const secret = "provider-secret"
	seen := make([]string, 0, 4)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		seen = append(seen, request.Method+" "+request.URL.Path)
		switch request.Method + " " + request.URL.Path {
		case "POST /byok":
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_, _ = writer.Write([]byte(`{"data":{"id":"byok-1","provider":"openai","name":"primary","disabled":false,"is_fallback":true,"label":"openai:primary","sort_order":1}}`))
		case "GET /byok/byok-1":
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"data":{"id":"byok-1","provider":"openai","name":"primary","disabled":false,"is_fallback":true,"label":"openai:primary","sort_order":1}}`))
		case "PATCH /byok/byok-1":
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"data":{"id":"byok-1","provider":"openai","name":"rotated","disabled":true,"is_fallback":false,"label":"openai:rotated","sort_order":2}}`))
		case "DELETE /byok/byok-1":
			writer.WriteHeader(http.StatusNoContent)
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	client := newClient(server.URL, "management-key")
	request := byokRequest{Provider: "openai", Key: secret, Name: stringPointerForTest("primary")}
	created, err := client.create(context.Background(), request)
	if err != nil || created.ID != "byok-1" {
		t.Fatalf("create = %#v, %v", created, err)
	}
	read, status, err := client.read(context.Background(), created.ID)
	if err != nil || status != http.StatusOK || read.Name != "primary" {
		t.Fatalf("read = %#v, %d, %v", read, status, err)
	}
	updated, err := client.update(context.Background(), created.ID, byokRequest{Provider: "openai", Key: secret, Name: stringPointerForTest("rotated")})
	if err != nil || updated.Name != "rotated" {
		t.Fatalf("update = %#v, %v", updated, err)
	}
	status, err = client.delete(context.Background(), created.ID)
	if err != nil || status != http.StatusNoContent {
		t.Fatalf("delete = %d, %v", status, err)
	}

	if strings.Join(seen, ",") != "POST /byok,GET /byok/byok-1,PATCH /byok/byok-1,DELETE /byok/byok-1" {
		t.Fatalf("request sequence = %q", strings.Join(seen, ","))
	}
}

func TestRequestFromModelUsesConfiguredWriteOnlyKey(t *testing.T) {
	request := requestFromModel(
		byokModel{Provider: types.StringValue("openai")},
		types.StringValue("configured-secret"),
	)
	if request.Key != "configured-secret" {
		t.Fatalf("request key = %q, want configured key", request.Key)
	}
}

func stringPointerForTest(value string) *string {
	return &value
}

func TestClientNotFoundAndSecretRedaction(t *testing.T) {
	const secret = "do-not-leak"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/byok" {
			writer.WriteHeader(http.StatusInternalServerError)
			_, _ = writer.Write([]byte(secret))
			return
		}
		writer.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := newClient(server.URL, "management-key")
	_, status, err := client.read(context.Background(), "missing")
	if err != nil || status != http.StatusNotFound {
		t.Fatalf("read missing = %d, %v", status, err)
	}
	if err != nil && strings.Contains(err.Error(), secret) {
		t.Fatalf("error leaked secret: %v", err)
	}
	_, err = client.create(context.Background(), byokRequest{Provider: "openai", Key: secret})
	if err == nil || !strings.Contains(err.Error(), "POST /byok") || strings.Contains(err.Error(), secret) {
		t.Fatalf("create error = %v", err)
	}
	status, err = client.delete(context.Background(), "missing")
	if err != nil || status != http.StatusNotFound {
		t.Fatalf("delete missing = %d, %v", status, err)
	}
}

func TestCreateAndUpdateRejectNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := newClient(server.URL, "management-key")
	created, err := client.create(context.Background(), byokRequest{Provider: "openai", Key: "secret"})
	if err == nil {
		t.Fatalf("create on 404 = %#v, want error", created)
	}
	updated, err := client.update(context.Background(), "byok-1", byokRequest{Provider: "openai", Key: "secret"})
	if err == nil {
		t.Fatalf("update on 404 = %#v, want error", updated)
	}
}

func TestClientRejectsSuccessfulResponseWithoutCredentialID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"data":{"provider":"openai"}}`))
	}))
	defer server.Close()

	client := newClient(server.URL, "management-key")
	created, err := client.create(context.Background(), byokRequest{Provider: "openai", Key: "secret"})
	if err == nil || !strings.Contains(err.Error(), "without a credential ID") {
		t.Fatalf("create = %#v, %v; want missing-ID error", created, err)
	}
}
