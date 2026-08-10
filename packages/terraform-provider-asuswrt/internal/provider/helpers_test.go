package provider

import (
	"strconv"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
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

// TestResolveReadHostname pins the refresh convergence rule: a lease configured
// with hostname = "" must not be nulled on refresh, or plan/apply loops forever
// diffing the explicit empty string against null.
func TestResolveReadHostname(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		prior          types.String
		routerHostname string
		want           types.String
	}{
		{
			name:           "configured empty survives refresh",
			prior:          types.StringValue(""),
			routerHostname: "",
			want:           types.StringValue(""),
		},
		{
			name:           "null stays null",
			prior:          types.StringNull(),
			routerHostname: "",
			want:           types.StringNull(),
		},
		{
			name:           "externally cleared hostname becomes null",
			prior:          types.StringValue("myhost"),
			routerHostname: "",
			want:           types.StringNull(),
		},
		{
			name:           "router hostname wins over null prior",
			prior:          types.StringNull(),
			routerHostname: "myhost",
			want:           types.StringValue("myhost"),
		},
		{
			name:           "router hostname wins over configured empty",
			prior:          types.StringValue(""),
			routerHostname: "set-outside-terraform",
			want:           types.StringValue("set-outside-terraform"),
		},
		{
			name:           "externally changed hostname is reported",
			prior:          types.StringValue("old"),
			routerHostname: "new",
			want:           types.StringValue("new"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := resolveReadHostname(tt.prior, tt.routerHostname)
			if !got.Equal(tt.want) {
				t.Errorf("expected %v, got %v", tt.want, got)
			}
		})
	}
}

// TestApplyPlanToEntryPreservesTrailingFields pins the update-path invariant:
// a plan carries only the modeled fields, so applying one must not disturb the
// router's own trailing fields. The whole vts_rulelist is re-serialized on every
// write, so clearing them here would erase them from the device.
func TestApplyPlanToEntryPreservesTrailingFields(t *testing.T) {
	t.Parallel()

	plan := portForwardResourceModel{
		Name:         types.StringValue("HTTP"),
		Protocol:     types.StringValue("tcp"),
		ExternalPort: types.StringValue("8080"),
		InternalIP:   types.StringValue("192.168.1.100"),
		InternalPort: types.StringValue("80"),
		SourceIP:     types.StringNull(),
	}

	entry := client.PortForwardEntry{
		Name:         "HTTP",
		Protocol:     "tcp",
		ExternalPort: "80",
		InternalIP:   "192.168.1.100",
		InternalPort: "80",
		SourceIP:     "10.0.0.1",
		Extra:        "firmware-specific",
		HasExtra:     true,
	}

	applyPlanToEntry(&entry, &plan)

	if entry.Extra != "firmware-specific" || !entry.HasExtra {
		t.Errorf("expected trailing fields preserved, got Extra=%q HasExtra=%v", entry.Extra, entry.HasExtra)
	}

	if entry.ExternalPort != "8080" {
		t.Errorf("expected the modeled field updated, got %q", entry.ExternalPort)
	}

	// A cleared source_ip must reach the router, not linger from the old entry.
	if entry.SourceIP != "" {
		t.Errorf("expected source IP cleared, got %q", entry.SourceIP)
	}
}

// TestApplyPlanToEntryLeavesAbsentTrailingFieldAbsent guards the other
// direction: applying a plan must not invent a trailing field.
func TestApplyPlanToEntryLeavesAbsentTrailingFieldAbsent(t *testing.T) {
	t.Parallel()

	plan := portForwardResourceModel{
		Name:         types.StringValue("SSH"),
		Protocol:     types.StringValue("tcp"),
		ExternalPort: types.StringValue("2222"),
		InternalIP:   types.StringValue("192.168.1.50"),
		InternalPort: types.StringValue("22"),
		SourceIP:     types.StringValue("10.0.0.2"),
	}

	entry := client.PortForwardEntry{Name: "SSH"}

	applyPlanToEntry(&entry, &plan)

	if entry.HasExtra || entry.Extra != "" {
		t.Errorf("expected no trailing field, got Extra=%q HasExtra=%v", entry.Extra, entry.HasExtra)
	}

	if entry.SourceIP != "10.0.0.2" {
		t.Errorf("expected source IP applied, got %q", entry.SourceIP)
	}
}

// TestPackedFieldValidator covers the boundary rejection that keeps packed
// NVRAM lists parseable. A value carrying a delimiter token cannot be
// represented in the router's flat, unescaped list format.
func TestPackedFieldValidator(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		value   types.String
		wantErr bool
	}{
		{name: "ordinary value", value: types.StringValue("Plex"), wantErr: false},
		{name: "value with a real angle bracket", value: types.StringValue("a>b"), wantErr: false},
		{name: "null", value: types.StringNull(), wantErr: false},
		{name: "unknown", value: types.StringUnknown(), wantErr: false},
		{name: "field delimiter token", value: types.StringValue("foo&#62bar"), wantErr: true},
		{name: "entry delimiter token", value: types.StringValue("foo&#60bar"), wantErr: true},
		{name: "delimiter alone", value: types.StringValue("&#62"), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := validator.StringRequest{Path: path.Root("name"), ConfigValue: tt.value}
			resp := &validator.StringResponse{}

			packedFieldValidator{}.ValidateString(t.Context(), req, resp)

			if got := resp.Diagnostics.HasError(); got != tt.wantErr {
				t.Errorf("expected error=%v, got %v (%v)", tt.wantErr, got, resp.Diagnostics)
			}
		})
	}
}

// TestPackedDelimiterCorruptsList documents why the validator exists: an
// unrejected delimiter shifts every following field on the next parse, and the
// corrupted shape is what a later whole-list rewrite sends to the router.
func TestPackedDelimiterCorruptsList(t *testing.T) {
	t.Parallel()

	entries := []client.PortForwardEntry{
		{Name: "evil&#62injected", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp"},
	}

	reparsed, err := client.ParseVTSRuleList(client.SerializeVTSRuleList(entries))
	if err != nil {
		t.Fatalf("parsing serialized vts_rulelist: %v", err)
	}

	if reparsed[0].Name != "evil" {
		t.Fatalf("expected the embedded delimiter to split the name, got %q", reparsed[0].Name)
	}

	if reparsed[0].ExternalPort == entries[0].ExternalPort {
		t.Error("expected the following fields to shift; the corruption this validator prevents did not occur")
	}
}
