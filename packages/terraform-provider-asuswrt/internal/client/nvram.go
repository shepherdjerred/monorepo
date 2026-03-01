package client

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// NvramGet reads multiple NVRAM keys in a single request.
func (c *Client) NvramGet(ctx context.Context, keys []string) (map[string]string, error) {
	hooks := make([]string, len(keys))
	for i, k := range keys {
		hooks[i] = "nvram_get(" + k + ")"
	}

	form := url.Values{}
	form.Set("hook", strings.Join(hooks, ";"))

	body, err := c.doRequest(ctx, "/appGet.cgi", form)
	if err != nil {
		return nil, fmt.Errorf("nvram get: %w", err)
	}

	var result map[string]string
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parsing nvram response: %w", err)
	}

	return result, nil
}

// NvramGetSingle reads a single NVRAM key.
func (c *Client) NvramGetSingle(ctx context.Context, key string) (string, error) {
	result, err := c.NvramGet(ctx, []string{key})
	if err != nil {
		return "", err
	}

	val, ok := result[key]
	if !ok {
		return "", nil
	}

	return val, nil
}

// NvramSet writes multiple NVRAM key-value pairs and optionally restarts a service.
func (c *Client) NvramSet(ctx context.Context, values map[string]string, rcService string) error {
	form := url.Values{}
	form.Set("action_mode", "apply")

	if rcService != "" {
		form.Set("rc_service", rcService)
	}

	for k, v := range values {
		form.Set(k, v)
	}

	body, err := c.doRequest(ctx, "/apply.cgi", form)
	if err != nil {
		return fmt.Errorf("nvram set: %w", err)
	}

	var result map[string]string
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("parsing apply response: %w", err)
	}

	return nil
}
