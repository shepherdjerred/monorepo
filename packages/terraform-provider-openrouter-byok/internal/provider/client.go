package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// requestTimeout bounds every BYOK API call so a stalled connection cannot hang
// a plan or apply indefinitely.
const requestTimeout = 60 * time.Second

type client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

type byokRequest struct {
	Provider       string   `json:"provider"`
	Key            string   `json:"key"`
	Name           string   `json:"name,omitempty"`
	WorkspaceID    string   `json:"workspace_id,omitempty"`
	AllowedModels  []string `json:"allowed_models,omitempty"`
	AllowedUserIDs []string `json:"allowed_user_ids,omitempty"`
	Disabled       *bool    `json:"disabled,omitempty"`
	IsFallback     *bool    `json:"is_fallback,omitempty"`
}

type byokResponse struct {
	Data byokData `json:"data"`
}

type byokData struct {
	ID             string   `json:"id"`
	Provider       string   `json:"provider"`
	Name           string   `json:"name"`
	WorkspaceID    string   `json:"workspace_id"`
	AllowedModels  []string `json:"allowed_models"`
	AllowedUserIDs []string `json:"allowed_user_ids"`
	Disabled       bool     `json:"disabled"`
	IsFallback     bool     `json:"is_fallback"`
	Label          string   `json:"label"`
	SortOrder      int64    `json:"sort_order"`
}

func newClient(baseURL string, apiKey string) *client {
	return &client{baseURL: strings.TrimRight(baseURL, "/"), apiKey: apiKey, http: &http.Client{Timeout: requestTimeout}}
}

func (c *client) request(ctx context.Context, method string, path string, body []byte) (byokData, int, error) {
	var result byokResponse
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return byokData{}, 0, fmt.Errorf("create OpenRouter request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return byokData{}, 0, fmt.Errorf("request OpenRouter BYOK API: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return byokData{}, response.StatusCode, fmt.Errorf("OpenRouter BYOK API %s %s returned HTTP %d", method, path, response.StatusCode)
	}
	if response.StatusCode == http.StatusNoContent {
		return byokData{}, response.StatusCode, nil
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		return byokData{}, response.StatusCode, fmt.Errorf("decode OpenRouter BYOK response: %w", err)
	}
	return result.Data, response.StatusCode, nil
}

func (c *client) create(ctx context.Context, request byokRequest) (byokData, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return byokData{}, fmt.Errorf("encode OpenRouter BYOK request: %w", err)
	}
	data, _, err := c.request(ctx, http.MethodPost, "/byok", body)
	return data, err
}

// read reports a 404 as an absent credential rather than an error so the
// resource can be dropped from state. Create and update deliberately do not
// share that tolerance: a 404 there means the request never reached the BYOK
// route and must not be recorded as success.
func (c *client) read(ctx context.Context, id string) (byokData, int, error) {
	data, status, err := c.request(ctx, http.MethodGet, "/byok/"+id, nil)
	if status == http.StatusNotFound {
		return byokData{}, status, nil
	}
	return data, status, err
}

func (c *client) update(ctx context.Context, id string, request byokRequest) (byokData, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return byokData{}, fmt.Errorf("encode OpenRouter BYOK request: %w", err)
	}
	data, _, err := c.request(ctx, http.MethodPatch, "/byok/"+id, body)
	return data, err
}

// delete treats an already-absent credential as a successful deletion.
func (c *client) delete(ctx context.Context, id string) (int, error) {
	_, status, err := c.request(ctx, http.MethodDelete, "/byok/"+id, nil)
	if status == http.StatusNotFound {
		return status, nil
	}
	return status, err
}
