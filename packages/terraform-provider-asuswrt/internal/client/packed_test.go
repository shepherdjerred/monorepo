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

	entries := client.ParseDHCPStaticList(liveDHCPStaticList)

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

	got := client.SerializeDHCPStaticList(client.ParseDHCPStaticList(liveDHCPStaticList))
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
				{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100"},
			},
		},
		{
			name:  "four-field entry with DNS and hostname",
			input: lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + "1.1.1.1" + gt + "server",
			expected: []client.DHCPStaticEntry{
				{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100", DNS: "1.1.1.1", Hostname: "server"},
			},
		},
		{
			name:  "multiple entries",
			input: lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + gt + lt + "11:22:33:44:55:66" + gt + "192.168.1.101" + gt + gt,
			expected: []client.DHCPStaticEntry{
				{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100"},
				{MAC: "11:22:33:44:55:66", IP: "192.168.1.101"},
			},
		},
		{
			name:     "missing separator",
			input:    lt + "AA:BB:CC:DD:EE:FF",
			expected: nil,
		},
		{
			name:  "empty MAC field",
			input: lt + gt + "192.168.1.100",
			expected: []client.DHCPStaticEntry{
				{MAC: "", IP: "192.168.1.100"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result := client.ParseDHCPStaticList(tt.input)

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

	got := client.SerializeDHCPStaticList(client.ParseDHCPStaticList(raw))
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

	parsed := client.ParseDHCPStaticList(client.SerializeDHCPStaticList(entries))

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

	rules := client.ParseVTSRuleList(liveVTSRuleList)

	want := []client.PortForwardEntry{
		{Name: "Plex", ExternalPort: "32400", InternalIP: "192.168.1.81", InternalPort: "32400", Protocol: "TCP"},
		{Name: "Minecraft mc-router", ExternalPort: "30000", InternalIP: "192.168.1.81", InternalPort: "30000", Protocol: "TCP"},
		{Name: "Mineraft Bedrock", ExternalPort: "30003", InternalIP: "192.168.1.81", InternalPort: "30003", Protocol: "UDP"},
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

	got := client.SerializeVTSRuleList(client.ParseVTSRuleList(liveVTSRuleList))
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
				{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp"},
			},
		},
		{
			name:  "single rule with source",
			input: lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp" + gt + "10.0.0.1",
			expected: []client.PortForwardEntry{
				{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp", SourceIP: "10.0.0.1"},
			},
		},
		{
			name:  "multiple rules",
			input: lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp" + gt + lt + "SSH" + gt + "2222" + gt + "192.168.1.50" + gt + "22" + gt + "tcp" + gt,
			expected: []client.PortForwardEntry{
				{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp"},
				{Name: "SSH", ExternalPort: "2222", InternalIP: "192.168.1.50", InternalPort: "22", Protocol: "tcp"},
			},
		},
		{
			name:     "too few fields",
			input:    lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80",
			expected: nil,
		},
		{
			name:  "port ranges",
			input: lt + "Game" + gt + "27015:27020" + gt + "192.168.1.200" + gt + "27015:27020" + gt + "udp",
			expected: []client.PortForwardEntry{
				{Name: "Game", ExternalPort: "27015:27020", InternalIP: "192.168.1.200", InternalPort: "27015:27020", Protocol: "udp"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result := client.ParseVTSRuleList(tt.input)

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

	parsed := client.ParseVTSRuleList(client.SerializeVTSRuleList(entries))

	if len(parsed) != len(entries) {
		t.Fatalf("round-trip: expected %d entries, got %d", len(entries), len(parsed))
	}

	for i, e := range entries {
		if parsed[i] != e {
			t.Errorf("round-trip entry %d: expected %+v, got %+v", i, e, parsed[i])
		}
	}
}

// The following tests assert that Serialize produces exactly what the router's
// own web-UI JavaScript builder emits — an INDEPENDENT oracle (the firmware
// spec), not a round-trip through our own parser. This is the strongest
// write-path check available without applying to real hardware.
//
// DHCP builder (Advanced_DHCP_Content.asp):
//   dhcp_staticlist += "<" + mac + ">" + ip + ">" + dns + ">" + hostname
// VTS builder (Advanced_VirtualServer_Content.asp):
//   value += "<" + name + ">" + extPort + ">" + intIP + ">" + intPort + ">" + proto + ">" + srcIP
// (angle brackets are stored as the &#60/&#62 entity tokens on the wire.)

func TestSerializeDHCPStaticListMatchesFirmwareBuilder(t *testing.T) {
	t.Parallel()

	got := client.SerializeDHCPStaticList([]client.DHCPStaticEntry{
		{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100"},                                 // no DNS/hostname
		{MAC: "11:22:33:44:55:66", IP: "192.168.1.50", DNS: "1.1.1.1", Hostname: "nas"}, // all fields
	})

	want := lt + "AA:BB:CC:DD:EE:FF" + gt + "192.168.1.100" + gt + gt +
		lt + "11:22:33:44:55:66" + gt + "192.168.1.50" + gt + "1.1.1.1" + gt + "nas"

	if got != want {
		t.Errorf("serialize != firmware builder format:\n want = %q\n got  = %q", want, got)
	}
}

func TestSerializeVTSRuleListMatchesFirmwareBuilder(t *testing.T) {
	t.Parallel()

	got := client.SerializeVTSRuleList([]client.PortForwardEntry{
		{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp"},                       // empty src → trailing delimiter
		{Name: "SSH", ExternalPort: "2222", InternalIP: "192.168.1.50", InternalPort: "22", Protocol: "tcp", SourceIP: "10.0.0.1"}, // src set
	})

	want := lt + "HTTP" + gt + "80" + gt + "192.168.1.100" + gt + "80" + gt + "tcp" + gt +
		lt + "SSH" + gt + "2222" + gt + "192.168.1.50" + gt + "22" + gt + "tcp" + gt + "10.0.0.1"

	if got != want {
		t.Errorf("serialize != firmware builder format:\n want = %q\n got  = %q", want, got)
	}
}
