package provider

import (
	"strconv"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/shepherdjerred/monorepo/packages/terraform-provider-asuswrt/internal/client"
)

func TestParseChannel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		chanspec string
		want     int
		wantErr  bool
	}{
		{"0", 0, false},
		{"", 0, false},
		{"6", 6, false},
		{"36/80", 36, false},
		{"149/160", 149, false},
		{"6u", 6, false},          // 2.4 GHz 40 MHz upper sideband
		{"6l", 6, false},          // 2.4 GHz 40 MHz lower sideband
		{"6g37/320-1", 37, false}, // 6 GHz WiFi7 band-prefixed form
		{"abc", 0, true},
		{"/80", 0, true},
	}

	for _, tc := range tests {
		t.Run(tc.chanspec, func(t *testing.T) {
			t.Parallel()

			got, err := parseChannel(tc.chanspec)
			if tc.wantErr {
				if err == nil {
					t.Errorf("parseChannel(%q) = %d, want error", tc.chanspec, got)
				}

				return
			}

			if err != nil {
				t.Errorf("parseChannel(%q) unexpected error: %v", tc.chanspec, err)

				return
			}

			if got != tc.want {
				t.Errorf("parseChannel(%q) = %d, want %d", tc.chanspec, got, tc.want)
			}
		})
	}
}

func TestFormatChanspec(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		channel   int
		bandwidth int
		want      string
		wantErr   bool
	}{
		{"auto", 0, 0, "0", false},
		{"channel-only", 6, 0, "6", false},
		{"bw-20", 6, 1, "6/20", false},
		{"bw-40", 36, 2, "36/40", false},
		{"bw-80-code-3", 149, 3, "149/80", false},
		{"bw-80-code-4", 36, 4, "36/80", false},
		{"bw-160", 149, 5, "149/160", false},
		{"unsupported-bw", 6, 7, "", true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := formatChanspec(tc.channel, tc.bandwidth)
			if tc.wantErr {
				if err == nil {
					t.Errorf("formatChanspec(%d, %d) = %q, want error", tc.channel, tc.bandwidth, got)
				}
				return
			}
			if err != nil {
				t.Errorf("formatChanspec(%d, %d) unexpected error: %v", tc.channel, tc.bandwidth, err)
			}
			if got != tc.want {
				t.Errorf("formatChanspec(%d, %d) = %q, want %q", tc.channel, tc.bandwidth, got, tc.want)
			}
		})
	}
}

func TestBandwidthToString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		bw      int
		want    string
		wantErr bool
	}{
		{"zero-auto", 0, "", false},
		{"1", 1, "20", false},
		{"2", 2, "40", false},
		{"3", 3, "80", false},
		{"4", 4, "80", false},
		{"5", 5, "160", false},
		{"unsupported", 7, "", true},
		{"negative", -1, "", true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := bandwidthToString(tc.bw)
			if tc.wantErr {
				if err == nil {
					t.Errorf("bandwidthToString(%d) = %q, want error", tc.bw, got)
				}
				return
			}
			if err != nil {
				t.Errorf("bandwidthToString(%d) unexpected error: %v", tc.bw, err)
			}
			if got != tc.want {
				t.Errorf("bandwidthToString(%d) = %q, want %q", tc.bw, got, tc.want)
			}
		})
	}
}

func TestBoolToFlag(t *testing.T) {
	t.Parallel()

	tests := []struct {
		b    bool
		want string
	}{
		{true, "1"},
		{false, "0"},
	}

	for _, tc := range tests {
		t.Run(tc.want, func(t *testing.T) {
			t.Parallel()

			got := boolToFlag(tc.b)
			if got != tc.want {
				t.Errorf("boolToFlag(%v) = %q, want %q", tc.b, got, tc.want)
			}
		})
	}
}

func TestReadOptionalString(t *testing.T) {
	t.Parallel()

	t.Run("key-present-target-set-updates", func(t *testing.T) {
		t.Parallel()

		target := types.StringValue("old")
		result := map[string]string{"hostname": "new"}
		readOptionalString(&target, result, "hostname")

		if target.ValueString() != "new" {
			t.Errorf("expected target to be %q, got %q", "new", target.ValueString())
		}
	})

	t.Run("key-present-target-null-populates", func(t *testing.T) {
		t.Parallel()

		// Optional+Computed: a null target (e.g. fresh import) is populated so
		// state reflects the router.
		target := types.StringNull()
		result := map[string]string{"hostname": "new"}
		readOptionalString(&target, result, "hostname")

		if target.ValueString() != "new" {
			t.Errorf("expected target to be populated with %q, got %q (null=%v)", "new", target.ValueString(), target.IsNull())
		}
	})

	t.Run("key-missing-no-update", func(t *testing.T) {
		t.Parallel()

		target := types.StringValue("old")
		result := map[string]string{}
		readOptionalString(&target, result, "hostname")

		if target.ValueString() != "old" {
			t.Errorf("expected target to remain %q, got %q", "old", target.ValueString())
		}
	})

	t.Run("key-present-empty-clears-stale-value", func(t *testing.T) {
		t.Parallel()

		// The router cleared a previously-managed value out-of-band; this must
		// surface as drift (null) rather than leaving the stale prior value.
		target := types.StringValue("old")
		result := map[string]string{"hostname": ""}
		readOptionalString(&target, result, "hostname")

		if !target.IsNull() {
			t.Errorf("expected target to be cleared to null, got %q", target.ValueString())
		}
	})

	t.Run("key-present-empty-unknown-resolves-to-null", func(t *testing.T) {
		t.Parallel()

		// Optional+Computed: an Unknown target (plan left it unresolved because
		// config omitted it) must resolve to a known value after apply; an empty
		// router value means "resolve to null", not "stay Unknown".
		target := types.StringUnknown()
		result := map[string]string{"hostname": ""}
		readOptionalString(&target, result, "hostname")

		if target.IsUnknown() || !target.IsNull() {
			t.Errorf("expected target to resolve to null, got unknown=%v null=%v", target.IsUnknown(), target.IsNull())
		}
	})

	t.Run("key-present-empty-already-null-no-change", func(t *testing.T) {
		t.Parallel()

		target := types.StringNull()
		result := map[string]string{"hostname": ""}
		readOptionalString(&target, result, "hostname")

		if !target.IsNull() {
			t.Errorf("expected target to remain null, got %q", target.ValueString())
		}
	})
}

func TestReadOptionalBoolFromFlag(t *testing.T) {
	t.Parallel()

	t.Run("flag-1-sets-true", func(t *testing.T) {
		t.Parallel()

		target := types.BoolValue(false)
		result := map[string]string{"enabled": "1"}
		if err := readOptionalBoolFromFlag(&target, result, "enabled"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if !target.ValueBool() {
			t.Errorf("expected target to be true")
		}
	})

	t.Run("flag-0-sets-false", func(t *testing.T) {
		t.Parallel()

		target := types.BoolValue(true)
		result := map[string]string{"enabled": "0"}
		if err := readOptionalBoolFromFlag(&target, result, "enabled"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if target.ValueBool() {
			t.Errorf("expected target to be false")
		}
	})

	t.Run("target-null-populates", func(t *testing.T) {
		t.Parallel()

		// Optional+Computed: a null target is populated from the flag on import.
		target := types.BoolNull()
		result := map[string]string{"enabled": "1"}
		if err := readOptionalBoolFromFlag(&target, result, "enabled"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if target.IsNull() || !target.ValueBool() {
			t.Errorf("expected target to be populated true, got null=%v value=%v", target.IsNull(), target.ValueBool())
		}
	})

	t.Run("key-missing-no-change", func(t *testing.T) {
		t.Parallel()

		target := types.BoolValue(true)
		result := map[string]string{}
		if err := readOptionalBoolFromFlag(&target, result, "enabled"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if !target.ValueBool() {
			t.Errorf("expected target to remain true")
		}
	})

	t.Run("key-present-empty-clears-stale-value", func(t *testing.T) {
		t.Parallel()

		target := types.BoolValue(true)
		result := map[string]string{"enabled": ""}
		if err := readOptionalBoolFromFlag(&target, result, "enabled"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if !target.IsNull() {
			t.Errorf("expected target to be cleared to null, got %v", target.ValueBool())
		}
	})

	t.Run("non-boolean-value-errors", func(t *testing.T) {
		t.Parallel()

		// A malformed flag (e.g. after a firmware/key-layout change) must be
		// rejected, not silently coerced to false.
		target := types.BoolValue(true)
		result := map[string]string{"enabled": "2"}
		if err := readOptionalBoolFromFlag(&target, result, "enabled"); err == nil {
			t.Fatalf("expected error for non-boolean flag value, got none")
		}

		if !target.ValueBool() {
			t.Errorf("expected target to be left unchanged on error, got %v", target.ValueBool())
		}
	})
}

func TestReadOptionalInt64FromString(t *testing.T) {
	t.Parallel()

	t.Run("valid-int-updates", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Value(0)
		result := map[string]string{"port": "42"}
		if err := readOptionalInt64FromString(&target, result, "port"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if target.ValueInt64() != 42 {
			t.Errorf("expected target to be 42, got %d", target.ValueInt64())
		}
	})

	t.Run("non-numeric-value-errors", func(t *testing.T) {
		t.Parallel()

		// A malformed encoding (e.g. after a firmware/key-layout change) must be
		// rejected, not silently left at the prior value.
		target := types.Int64Value(7)
		result := map[string]string{"port": "abc"}
		if err := readOptionalInt64FromString(&target, result, "port"); err == nil {
			t.Fatalf("expected error for non-numeric value, got none")
		}

		if target.ValueInt64() != 7 {
			t.Errorf("expected target to be left unchanged on error, got %d", target.ValueInt64())
		}
	})

	t.Run("key-missing-no-change", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Value(5)
		result := map[string]string{}
		if err := readOptionalInt64FromString(&target, result, "port"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if target.ValueInt64() != 5 {
			t.Errorf("expected target to remain 5, got %d", target.ValueInt64())
		}
	})

	t.Run("target-null-populates", func(t *testing.T) {
		t.Parallel()

		// Optional+Computed: a null target is populated from the numeric value.
		target := types.Int64Null()
		result := map[string]string{"port": "42"}
		if err := readOptionalInt64FromString(&target, result, "port"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if target.IsNull() || target.ValueInt64() != 42 {
			t.Errorf("expected target to be populated 42, got null=%v value=%d", target.IsNull(), target.ValueInt64())
		}
	})

	t.Run("key-present-empty-clears-stale-value", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Value(42)
		result := map[string]string{"port": ""}
		if err := readOptionalInt64FromString(&target, result, "port"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if !target.IsNull() {
			t.Errorf("expected target to be cleared to null, got %d", target.ValueInt64())
		}
	})
}

func TestReadOptionalInt64(t *testing.T) {
	t.Parallel()

	identity := func(s string) (int, error) {
		return strconv.Atoi(s)
	}

	t.Run("key-present-target-set-updates", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Value(1)
		result := map[string]string{"channel": "6"}
		if err := readOptionalInt64(&target, result, "channel", identity); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if target.ValueInt64() != 6 {
			t.Errorf("expected target to be 6, got %d", target.ValueInt64())
		}
	})

	t.Run("target-unknown-resolves-via-transform", func(t *testing.T) {
		t.Parallel()

		// Optional+Computed: Unknown (plan left it unresolved on Create) must
		// resolve to a known value from the router's read-back.
		target := types.Int64Unknown()
		result := map[string]string{"channel": "36"}
		if err := readOptionalInt64(&target, result, "channel", identity); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if target.IsUnknown() || target.ValueInt64() != 36 {
			t.Errorf("expected target to resolve to 36, got unknown=%v value=%d", target.IsUnknown(), target.ValueInt64())
		}
	})

	t.Run("key-present-empty-clears-stale-value", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Value(6)
		result := map[string]string{"channel": ""}
		if err := readOptionalInt64(&target, result, "channel", identity); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if !target.IsNull() {
			t.Errorf("expected target to be cleared to null, got %d", target.ValueInt64())
		}
	})

	t.Run("key-missing-no-change", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Value(6)
		result := map[string]string{}
		if err := readOptionalInt64(&target, result, "channel", identity); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if target.ValueInt64() != 6 {
			t.Errorf("expected target to remain 6, got %d", target.ValueInt64())
		}
	})

	t.Run("transform-error-propagates", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Value(6)
		result := map[string]string{"channel": "bogus"}
		if err := readOptionalInt64(&target, result, "channel", identity); err == nil {
			t.Fatalf("expected error from transform, got none")
		}

		if target.ValueInt64() != 6 {
			t.Errorf("expected target to be left unchanged on error, got %d", target.ValueInt64())
		}
	})
}

func TestFindRuleByName(t *testing.T) {
	t.Parallel()

	entries := []client.PortForwardEntry{
		{Name: "SSH", ExternalPort: "22", InternalIP: "192.168.1.10", InternalPort: "22", Protocol: "TCP"},
		{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.20", InternalPort: "80", Protocol: "TCP"},
	}

	t.Run("exact-match", func(t *testing.T) {
		t.Parallel()

		got := findRuleByName(entries, "SSH")
		if got == nil || got.Name != "SSH" {
			t.Errorf("expected to find SSH rule, got %v", got)
		}
	})

	t.Run("case-insensitive-match", func(t *testing.T) {
		t.Parallel()

		got := findRuleByName(entries, "ssh")
		if got == nil || got.Name != "SSH" {
			t.Errorf("expected to find SSH rule via lowercase, got %v", got)
		}
	})

	t.Run("not-found", func(t *testing.T) {
		t.Parallel()

		got := findRuleByName(entries, "FTP")
		if got != nil {
			t.Errorf("expected nil for missing rule, got %v", got)
		}
	})

	t.Run("empty-list", func(t *testing.T) {
		t.Parallel()

		got := findRuleByName([]client.PortForwardEntry{}, "SSH")
		if got != nil {
			t.Errorf("expected nil for empty list, got %v", got)
		}
	})
}
