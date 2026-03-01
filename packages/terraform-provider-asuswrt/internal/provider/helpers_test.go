package provider

import (
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/shepherdjerred/terraform-provider-asuswrt/internal/client"
)

func TestParseChannel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		chanspec string
		want     int
	}{
		{"0", 0},
		{"6", 6},
		{"36/80", 36},
		{"149/160", 149},
		{"", 0},
		{"abc", 0},
		{"/80", 0},
	}

	for _, tc := range tests {
		t.Run(tc.chanspec, func(t *testing.T) {
			t.Parallel()

			got := parseChannel(tc.chanspec)
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
	}{
		{"auto", 0, 0, "0"},
		{"channel-only", 6, 0, "6"},
		{"bw-20", 6, 1, "6/20"},
		{"bw-40", 36, 2, "36/40"},
		{"bw-80", 36, 4, "36/80"},
		{"bw-160", 149, 5, "149/160"},
		{"unknown-bw", 6, 3, "6"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := formatChanspec(tc.channel, tc.bandwidth)
			if got != tc.want {
				t.Errorf("formatChanspec(%d, %d) = %q, want %q", tc.channel, tc.bandwidth, got, tc.want)
			}
		})
	}
}

func TestBandwidthToString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		bw   int
		want string
	}{
		{"zero", 0, ""},
		{"1", 1, "20"},
		{"2", 2, "40"},
		{"4", 4, "80"},
		{"5", 5, "160"},
		{"3-unknown", 3, ""},
		{"negative", -1, ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := bandwidthToString(tc.bw)
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

	t.Run("key-present-target-null-no-update", func(t *testing.T) {
		t.Parallel()

		target := types.StringNull()
		result := map[string]string{"hostname": "new"}
		readOptionalString(&target, result, "hostname")

		if !target.IsNull() {
			t.Errorf("expected target to remain null")
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
}

func TestReadOptionalBoolFromFlag(t *testing.T) {
	t.Parallel()

	t.Run("flag-1-sets-true", func(t *testing.T) {
		t.Parallel()

		target := types.BoolValue(false)
		result := map[string]string{"enabled": "1"}
		readOptionalBoolFromFlag(&target, result, "enabled")

		if !target.ValueBool() {
			t.Errorf("expected target to be true")
		}
	})

	t.Run("flag-0-sets-false", func(t *testing.T) {
		t.Parallel()

		target := types.BoolValue(true)
		result := map[string]string{"enabled": "0"}
		readOptionalBoolFromFlag(&target, result, "enabled")

		if target.ValueBool() {
			t.Errorf("expected target to be false")
		}
	})

	t.Run("target-null-skipped", func(t *testing.T) {
		t.Parallel()

		target := types.BoolNull()
		result := map[string]string{"enabled": "1"}
		readOptionalBoolFromFlag(&target, result, "enabled")

		if !target.IsNull() {
			t.Errorf("expected target to remain null")
		}
	})

	t.Run("key-missing-no-change", func(t *testing.T) {
		t.Parallel()

		target := types.BoolValue(true)
		result := map[string]string{}
		readOptionalBoolFromFlag(&target, result, "enabled")

		if !target.ValueBool() {
			t.Errorf("expected target to remain true")
		}
	})
}

func TestReadOptionalInt64FromString(t *testing.T) {
	t.Parallel()

	t.Run("valid-int-updates", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Value(0)
		result := map[string]string{"port": "42"}
		readOptionalInt64FromString(&target, result, "port")

		if target.ValueInt64() != 42 {
			t.Errorf("expected target to be 42, got %d", target.ValueInt64())
		}
	})

	t.Run("non-numeric-no-change", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Value(7)
		result := map[string]string{"port": "abc"}
		readOptionalInt64FromString(&target, result, "port")

		if target.ValueInt64() != 7 {
			t.Errorf("expected target to remain 7, got %d", target.ValueInt64())
		}
	})

	t.Run("key-missing-no-change", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Value(5)
		result := map[string]string{}
		readOptionalInt64FromString(&target, result, "port")

		if target.ValueInt64() != 5 {
			t.Errorf("expected target to remain 5, got %d", target.ValueInt64())
		}
	})

	t.Run("target-null-skipped", func(t *testing.T) {
		t.Parallel()

		target := types.Int64Null()
		result := map[string]string{"port": "42"}
		readOptionalInt64FromString(&target, result, "port")

		if !target.IsNull() {
			t.Errorf("expected target to remain null")
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
