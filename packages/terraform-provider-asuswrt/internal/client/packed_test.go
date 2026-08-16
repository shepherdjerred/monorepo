package client_test

import (
	"testing"

	"github.com/shepherdjerred/monorepo/packages/terraform-provider-asuswrt/internal/client"
)

// Asuswrt delimits packed NVRAM lists with HTML numeric character references,
// not literal angle brackets. These match the tokens the real router returns.
const (
	lt = "&#60" // '<'
	gt = "&#62" // '>'
)

// Verbatim NVRAM values captured read-only from a live RT-AX88U Pro
// (firmware 3.0.0.6.102.7_2) on 2026-07-03. These are the ground truth for
// round-trip fidelity: Serialize(Parse(raw)) MUST equal raw byte-for-byte.
const (
	liveDHCPStaticList = lt + "08:BF:B8:D4:59:7F" + gt + "192.168.1.81" + gt + gt +
		lt + "48:DA:35:6F:61:BF" + gt + "192.168.1.61" + gt + gt +
		lt + "4C:B9:EA:97:90:5A" + gt + "192.168.1.90" + gt + gt +
		lt + "50:26:EF:28:F1:DE" + gt + "192.168.1.43" + gt + gt +
		lt + "50:26:EF:29:70:EE" + gt + "192.168.1.173" + gt + gt

	liveVTSRuleList = lt + "Plex" + gt + "32400" + gt + "192.168.1.81" + gt + "32400" + gt + "TCP" + gt +
		lt + "Minecraft mc-router" + gt + "30000" + gt + "192.168.1.81" + gt + "30000" + gt + "TCP" + gt +
		lt + "Mineraft Bedrock" + gt + "30003" + gt + "192.168.1.81" + gt + "30003" + gt + "UDP" + gt
)

func TestParseDHCPStaticListLive(t *testing.T) {
	t.Parallel()

	entries, err := client.ParseDHCPStaticList(liveDHCPStaticList)
	if err != nil {
		t.Fatalf("parsing live dhcp_staticlist: %v", err)
	}

	want := []client.DHCPStaticEntry{
		{MAC: "08:BF:B8:D4:59:7F", IP: "192.168.1.81"},
		{MAC: "48:DA:35:6F:61:BF", IP: "192.168.1.61"},
		{MAC: "4C:B9:EA:97:90:5A", IP: "192.168.1.90"},
		{MAC: "50:26:EF:28:F1:DE", IP: "192.168.1.43"},
		{MAC: "50:26:EF:29:70:EE", IP: "192.168.1.173"},
	}

	if len(entries) != len(want) {
		t.Fatalf("expected %d entries from live data, got %d", len(want), len(entries))
	}

	for i, e := range want {
		if entries[i].MAC != e.MAC || entries[i].IP != e.IP {
			t.Errorf("entry %d: expected %+v, got %+v", i, e, entries[i])
		}
	}
}

// TestDHCPStaticListLiveRoundTrip is the anti-regression for the delimiter bug:
// the parser previously split on literal '<'/'>' and returned zero entries.
func TestDHCPStaticListLiveRoundTrip(t *testing.T) {
	t.Parallel()

	parsed, err := client.ParseDHCPStaticList(liveDHCPStaticList)
	if err != nil {
		t.Fatalf("parsing live dhcp_staticlist: %v", err)
	}

	got := client.SerializeDHCPStaticList(parsed)
	if got != liveDHCPStaticList {
		t.Errorf("round-trip mismatch:\n raw = %q\n got = %q", liveDHCPStaticList, got)
	}
}

func TestParseDHCPStaticList(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		expected []client.DHCPStaticEntry
		wantErr  bool
	}{
		{
			name:     "empty",
			input:    "",
			expected: nil,
		},
		{
			name:  "single entry (MAC/IP only)",
			input: lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100",
			expected: []client.DHCPStaticEntry{
				{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100", ModeledFields: 2},
			},
		},
		{
			name:  "four-field entry with DNS and hostname",
			input: lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + "1.1.1.1" + gt + "server",
			expected: []client.DHCPStaticEntry{
				{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100", DNS: "1.1.1.1", Hostname: "server", ModeledFields: 4},
			},
		},
		{
			name:  "multiple entries",
			input: lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + gt + lt + "11:22:33:44:55:66" + gt + "192.168.1.101" + gt + gt,
			expected: []client.DHCPStaticEntry{
				{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100", ModeledFields: 4},
				{MAC: "11:22:33:44:55:66", IP: "192.168.1.101", ModeledFields: 4},
			},
		},
		{
			// Fail closed: every mutation rewrites the whole list, so a
			// dropped entry would be deleted from the router permanently.
			name:    "missing separator is an error, not a skip",
			input:   lt + "AA:BB:CC:DD:EE:FF",
			wantErr: true,
		},
		{
			name:    "malformed entry among valid ones is an error",
			input:   lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + gt + lt + "11:22:33:44:55:66",
			wantErr: true,
		},
		{
			name:  "empty MAC field",
			input: lt + gt + "192.168.1.100",
			expected: []client.DHCPStaticEntry{
				{MAC: "", IP: "192.168.1.100", ModeledFields: 2},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result, err := client.ParseDHCPStaticList(tt.input)

			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %d entries", len(result))
				}

				if result != nil {
					t.Errorf("expected no entries alongside the error, got %+v", result)
				}

				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if len(result) != len(tt.expected) {
				t.Fatalf("expected %d entries, got %d", len(tt.expected), len(result))
			}

			for i, e := range tt.expected {
				if result[i] != e {
					t.Errorf("entry %d: expected %+v, got %+v", i, e, result[i])
				}
			}
		})
	}
}

// TestDHCPStaticListPreservesExtraFields ensures DNS/hostname survive a
// parse→serialize cycle so we never clobber per-client data belonging to
// entries this provider isn't managing.
func TestDHCPStaticListPreservesExtraFields(t *testing.T) {
	t.Parallel()

	raw := lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + "9.9.9.9" + gt + "myhost"

	parsed, err := client.ParseDHCPStaticList(raw)
	if err != nil {
		t.Fatalf("parsing dhcp_staticlist: %v", err)
	}

	got := client.SerializeDHCPStaticList(parsed)
	if got != raw {
		t.Errorf("expected DNS/hostname preserved:\n raw = %q\n got = %q", raw, got)
	}
}

func TestDHCPStaticListRoundTrip(t *testing.T) {
	t.Parallel()

	entries := []client.DHCPStaticEntry{
		{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100"},
		{MAC: "11:22:33:44:55:66", IP: "192.168.1.101"},
		{MAC: "DE:AD:BE:EF:CA:FE", IP: "192.168.1.200"},
	}

	parsed, err := client.ParseDHCPStaticList(client.SerializeDHCPStaticList(entries))
	if err != nil {
		t.Fatalf("parsing serialized dhcp_staticlist: %v", err)
	}

	if len(parsed) != len(entries) {
		t.Fatalf("round-trip: expected %d entries, got %d", len(entries), len(parsed))
	}

	for i, e := range entries {
		if parsed[i].MAC != e.MAC || parsed[i].IP != e.IP {
			t.Errorf("round-trip entry %d: expected %+v, got %+v", i, e, parsed[i])
		}
	}
}

func TestParseVTSRuleListLive(t *testing.T) {
	t.Parallel()

	rules, err := client.ParseVTSRuleList(liveVTSRuleList)
	if err != nil {
		t.Fatalf("parsing live vts_rulelist: %v", err)
	}

	want := []client.PortForwardEntry{
		{Name: "Plex", ExternalPort: "32400", InternalIP: "192.168.1.81", InternalPort: "32400", Protocol: "TCP", ModeledFields: 6},
		{Name: "Minecraft mc-router", ExternalPort: "30000", InternalIP: "192.168.1.81", InternalPort: "30000", Protocol: "TCP", ModeledFields: 6},
		{Name: "Mineraft Bedrock", ExternalPort: "30003", InternalIP: "192.168.1.81", InternalPort: "30003", Protocol: "UDP", ModeledFields: 6},
	}

	if len(rules) != len(want) {
		t.Fatalf("expected %d rules from live data, got %d", len(want), len(rules))
	}

	for i, e := range want {
		if rules[i] != e {
			t.Errorf("rule %d: expected %+v, got %+v", i, e, rules[i])
		}
	}
}

// TestVTSRuleListLiveRoundTrip guards the delimiter fix AND the trailing-field
// convention (the router keeps a trailing '>' after the protocol).
func TestVTSRuleListLiveRoundTrip(t *testing.T) {
	t.Parallel()

	parsed, err := client.ParseVTSRuleList(liveVTSRuleList)
	if err != nil {
		t.Fatalf("parsing live vts_rulelist: %v", err)
	}

	got := client.SerializeVTSRuleList(parsed)
	if got != liveVTSRuleList {
		t.Errorf("round-trip mismatch:\n raw = %q\n got = %q", liveVTSRuleList, got)
	}
}

func TestParseVTSRuleList(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		expected []client.PortForwardEntry
		wantErr  bool
	}{
		{
			name:     "empty",
			input:    "",
			expected: nil,
		},
		{
			name:  "single rule without source",
			input: lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp",
			expected: []client.PortForwardEntry{
				{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp", ModeledFields: 5},
			},
		},
		{
			name:  "single rule with source",
			input: lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp" + gt + "10.0.0.1",
			expected: []client.PortForwardEntry{
				{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp", SourceIP: "10.0.0.1", ModeledFields: 6},
			},
		},
		{
			name:  "multiple rules",
			input: lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp" + gt + lt + "SSH" + gt + "2222" + gt + "192.168.1.50" + gt + "22" + gt + "tcp" + gt,
			expected: []client.PortForwardEntry{
				{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp", ModeledFields: 6},
				{Name: "SSH", ExternalPort: "2222", InternalIP: "192.168.1.50", InternalPort: "22", Protocol: "tcp", ModeledFields: 6},
			},
		},
		{
			// Fail closed for the same reason as the DHCP list: a dropped
			// rule would be erased from the router by the next apply.
			name:    "too few fields is an error, not a skip",
			input:   lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80",
			wantErr: true,
		},
		{
			name:    "malformed rule among valid ones is an error",
			input:   lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp" + gt + lt + "SSH" + gt + "2222",
			wantErr: true,
		},
		{
			name:  "port ranges",
			input: lt + "Game" + gt + "27015:27020" + gt + "192.168.1.200" + gt + "27015:27020" + gt + "udp",
			expected: []client.PortForwardEntry{
				{Name: "Game", ExternalPort: "27015:27020", InternalIP: "192.168.1.200", InternalPort: "27015:27020", Protocol: "udp", ModeledFields: 5},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result, err := client.ParseVTSRuleList(tt.input)

			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %d entries", len(result))
				}

				if result != nil {
					t.Errorf("expected no entries alongside the error, got %+v", result)
				}

				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if len(result) != len(tt.expected) {
				t.Fatalf("expected %d entries, got %d", len(tt.expected), len(result))
			}

			for i, e := range tt.expected {
				if result[i] != e {
					t.Errorf("entry %d: expected %+v, got %+v", i, e, result[i])
				}
			}
		})
	}
}

func TestVTSRuleListRoundTrip(t *testing.T) {
	t.Parallel()

	entries := []client.PortForwardEntry{
		{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp"},
		{Name: "SSH", ExternalPort: "2222", InternalIP: "192.168.1.50", InternalPort: "22", Protocol: "tcp", SourceIP: "10.0.0.1"},
		{Name: "Game", ExternalPort: "27015", InternalIP: "192.168.1.200", InternalPort: "27015", Protocol: "both"},
	}

	// Entries this provider builds carry no parsed field count, so they
	// serialize to the router's full 6-field layout and parse back reporting it.
	want := make([]client.PortForwardEntry, len(entries))
	for i, e := range entries {
		e.ModeledFields = 6
		want[i] = e
	}

	parsed, err := client.ParseVTSRuleList(client.SerializeVTSRuleList(entries))
	if err != nil {
		t.Fatalf("parsing serialized vts_rulelist: %v", err)
	}

	if len(parsed) != len(want) {
		t.Fatalf("round-trip: expected %d entries, got %d", len(want), len(parsed))
	}

	for i, e := range want {
		if parsed[i] != e {
			t.Errorf("round-trip entry %d: expected %+v, got %+v", i, e, parsed[i])
		}
	}
}

// The following tests assert that Encode*ForWrite produces exactly what the
// router's own web-UI JavaScript builder submits — an INDEPENDENT oracle (the
// firmware spec), not a round-trip through our own parser.
//
// DHCP builder (Advanced_DHCP_Content.asp):
//   dhcp_staticlist += "<" + mac + ">" + ip + ">" + dns + ">" + hostname
// VTS builder (Advanced_VirtualServer_Content.asp):
//   value += "<" + name + ">" + extPort + ">" + intIP + ">" + intPort + ">" + proto + ">" + srcIP
// appGet.cgi returns those angle brackets as &#60/&#62, but apply.cgi expects the
// literal builder output. Submitting the read representation double-escapes
// the ampersands and corrupts the list.

func TestEncodeDHCPStaticListForWriteMatchesFirmwareBuilder(t *testing.T) {
	t.Parallel()

	got := client.EncodeDHCPStaticListForWrite([]client.DHCPStaticEntry{
		{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100"},                                 // no DNS/hostname
		{MAC: "11:22:33:44:55:66", IP: "192.168.1.50", DNS: "1.1.1.1", Hostname: "nas"}, // all fields
	})

	want := "<AA:BB:CC:DD:EE:FF>192.168.1.100>>" +
		"<11:22:33:44:55:66>192.168.1.50>1.1.1.1>nas"

	if got != want {
		t.Errorf("serialize != firmware builder format:\n want = %q\n got  = %q", want, got)
	}
}

func TestEncodeVTSRuleListForWriteMatchesFirmwareBuilder(t *testing.T) {
	t.Parallel()

	got := client.EncodeVTSRuleListForWrite([]client.PortForwardEntry{
		{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp"},                       // empty src → trailing delimiter
		{Name: "SSH", ExternalPort: "2222", InternalIP: "192.168.1.50", InternalPort: "22", Protocol: "tcp", SourceIP: "10.0.0.1"}, // src set
	})

	want := "<HTTP>80>192.168.1.100>80>tcp>" +
		"<SSH>2222>192.168.1.50>22>tcp>10.0.0.1"

	if got != want {
		t.Errorf("serialize != firmware builder format:\n want = %q\n got  = %q", want, got)
	}
}

// TestPackedListsPreserveTrailingFields covers firmware that returns more
// fields than this provider models. Every mutation rewrites the whole list, so
// an unmodeled trailing field must survive parse→serialize or an unrelated
// apply would strip it from the router.
func TestPackedListsPreserveTrailingFields(t *testing.T) {
	t.Parallel()

	t.Run("dhcp fifth field round-trips", func(t *testing.T) {
		t.Parallel()

		raw := lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + "1.1.1.1" + gt + "host" + gt + "future"

		parsed, err := client.ParseDHCPStaticList(raw)
		if err != nil {
			t.Fatalf("parsing dhcp_staticlist: %v", err)
		}

		if len(parsed) != 1 {
			t.Fatalf("expected 1 entry, got %d", len(parsed))
		}

		if parsed[0].Extra != "future" {
			t.Errorf("expected trailing field retained, got %q", parsed[0].Extra)
		}

		if got := client.SerializeDHCPStaticList(parsed); got != raw {
			t.Errorf("round-trip dropped data:\n raw = %q\n got = %q", raw, got)
		}
	})

	t.Run("dhcp multiple trailing fields round-trip", func(t *testing.T) {
		t.Parallel()

		raw := lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + gt + gt + "a" + gt + "b"

		parsed, err := client.ParseDHCPStaticList(raw)
		if err != nil {
			t.Fatalf("parsing dhcp_staticlist: %v", err)
		}

		if got := client.SerializeDHCPStaticList(parsed); got != raw {
			t.Errorf("round-trip dropped data:\n raw = %q\n got = %q", raw, got)
		}
	})

	// An entry ending in a bare delimiter has one trailing field whose value is
	// empty. Presence must be preserved separately from value, or the packed
	// shape silently loses a field position.
	t.Run("dhcp empty fifth field keeps its position", func(t *testing.T) {
		t.Parallel()

		raw := lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + "1.1.1.1" + gt + "host" + gt

		parsed, err := client.ParseDHCPStaticList(raw)
		if err != nil {
			t.Fatalf("parsing dhcp_staticlist: %v", err)
		}

		if !parsed[0].HasExtra {
			t.Error("expected the empty trailing field to be recorded as present")
		}

		if parsed[0].Extra != "" {
			t.Errorf("expected an empty trailing value, got %q", parsed[0].Extra)
		}

		if got := client.SerializeDHCPStaticList(parsed); got != raw {
			t.Errorf("round-trip changed shape:\n raw = %q\n got = %q", raw, got)
		}
	})

	t.Run("port-forward empty seventh field keeps its position", func(t *testing.T) {
		t.Parallel()

		raw := lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp" + gt + "10.0.0.1" + gt

		parsed, err := client.ParseVTSRuleList(raw)
		if err != nil {
			t.Fatalf("parsing vts_rulelist: %v", err)
		}

		if !parsed[0].HasExtra {
			t.Error("expected the empty trailing field to be recorded as present")
		}

		if got := client.SerializeVTSRuleList(parsed); got != raw {
			t.Errorf("round-trip changed shape:\n raw = %q\n got = %q", raw, got)
		}
	})

	t.Run("no trailing field stays absent", func(t *testing.T) {
		t.Parallel()

		raw := lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + "1.1.1.1" + gt + "host"

		parsed, err := client.ParseDHCPStaticList(raw)
		if err != nil {
			t.Fatalf("parsing dhcp_staticlist: %v", err)
		}

		if parsed[0].HasExtra {
			t.Error("expected no trailing field to be recorded")
		}

		if got := client.SerializeDHCPStaticList(parsed); got != raw {
			t.Errorf("round-trip invented a field:\n raw = %q\n got = %q", raw, got)
		}
	})

	t.Run("port-forward seventh field round-trips", func(t *testing.T) {
		t.Parallel()

		raw := lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp" + gt + "10.0.0.1" + gt + "future"

		parsed, err := client.ParseVTSRuleList(raw)
		if err != nil {
			t.Fatalf("parsing vts_rulelist: %v", err)
		}

		if len(parsed) != 1 {
			t.Fatalf("expected 1 rule, got %d", len(parsed))
		}

		if parsed[0].Extra != "future" {
			t.Errorf("expected trailing field retained, got %q", parsed[0].Extra)
		}

		if got := client.SerializeVTSRuleList(parsed); got != raw {
			t.Errorf("round-trip dropped data:\n raw = %q\n got = %q", raw, got)
		}
	})
}

// TestPackedListRejectsMalformedShapes covers segment-level structure. Each of
// these used to parse "successfully" and then be rewritten in a normalized
// encoding by the next mutation, converting NVRAM this provider did not
// understand into an active entry.
func TestPackedListRejectsMalformedShapes(t *testing.T) {
	t.Parallel()

	valid := lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + gt

	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{name: "empty value is a valid empty list", input: "", wantErr: false},
		{name: "well-formed value", input: valid, wantErr: false},
		{
			name:    "missing leading delimiter",
			input:   "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + gt,
			wantErr: true,
		},
		{
			name:    "two well-formed entries",
			input:   valid + valid,
			wantErr: false,
		},
		{
			name:    "repeated delimiter between entries",
			input:   valid + lt + valid,
			wantErr: true,
		},
		{name: "trailing delimiter", input: valid + lt, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			_, err := client.ParseDHCPStaticList(tt.input)
			if gotErr := err != nil; gotErr != tt.wantErr {
				t.Errorf("dhcp: expected error=%v, got %v (%v)", tt.wantErr, gotErr, err)
			}

			// The same structural rules apply to the port-forward list.
			_, err = client.ParseVTSRuleList(tt.input)
			if tt.wantErr && err == nil {
				t.Error("vts: expected a structural error, got none")
			}
		})
	}
}

// TestShortEntriesKeepTheirPackedShape covers the layout-preservation
// contract. The parsers deliberately accept a 2-field DHCP entry and a 5-field
// VTS rule, but every mutation rewrites the whole list, so serializing those
// back with the trailing empty fields appended would silently change the packed
// shape of entries the operator never touched.
func TestShortEntriesKeepTheirPackedShape(t *testing.T) {
	t.Parallel()

	lt, gt := client.PackedDelimiters()[0], client.PackedDelimiters()[1]

	t.Run("dhcp short entry round-trips byte-for-byte", func(t *testing.T) {
		t.Parallel()

		raw := lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100"

		entries, err := client.ParseDHCPStaticList(raw)
		if err != nil {
			t.Fatalf("parsing: %v", err)
		}

		if got := client.SerializeDHCPStaticList(entries); got != raw {
			t.Errorf("serialize = %q, want the original %q", got, raw)
		}
	})

	t.Run("vts short rule round-trips byte-for-byte", func(t *testing.T) {
		t.Parallel()

		raw := lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp"

		entries, err := client.ParseVTSRuleList(raw)
		if err != nil {
			t.Fatalf("parsing: %v", err)
		}

		if got := client.SerializeVTSRuleList(entries); got != raw {
			t.Errorf("serialize = %q, want the original %q", got, raw)
		}
	})

	t.Run("dhcp short entry widens when a later field is set", func(t *testing.T) {
		t.Parallel()

		raw := lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100"

		entries, err := client.ParseDHCPStaticList(raw)
		if err != nil {
			t.Fatalf("parsing: %v", err)
		}

		entries[0].Hostname = "desktop"

		want := raw + gt + gt + "desktop"
		if got := client.SerializeDHCPStaticList(entries); got != want {
			t.Errorf("serialize = %q, want %q", got, want)
		}
	})

	t.Run("vts short rule widens when the source IP is set", func(t *testing.T) {
		t.Parallel()

		raw := lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp"

		entries, err := client.ParseVTSRuleList(raw)
		if err != nil {
			t.Fatalf("parsing: %v", err)
		}

		entries[0].SourceIP = "10.0.0.1"

		want := raw + gt + "10.0.0.1"
		if got := client.SerializeVTSRuleList(entries); got != want {
			t.Errorf("serialize = %q, want %q", got, want)
		}
	})

	t.Run("provider-built entry uses the full layout", func(t *testing.T) {
		t.Parallel()

		entries := []client.DHCPStaticEntry{{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100"}}

		want := lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + gt
		if got := client.SerializeDHCPStaticList(entries); got != want {
			t.Errorf("serialize = %q, want the router's native %q", got, want)
		}
	})
}
