package client_test

import (
	"strings"
	"testing"

	"github.com/shepherdjerred/terraform-provider-asuswrt/internal/client"
)

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
			name:  "single entry",
			input: "<AA:BB:CC:DD:EE:FF>192.168.1.100",
			expected: []client.DHCPStaticEntry{
				{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100"},
			},
		},
		{
			name:  "multiple entries",
			input: "<AA:BB:CC:DD:EE:FF>192.168.1.100<11:22:33:44:55:66>192.168.1.101",
			expected: []client.DHCPStaticEntry{
				{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100"},
				{MAC: "11:22:33:44:55:66", IP: "192.168.1.101"},
			},
		},
		{
			name:  "trailing delimiter",
			input: "<AA:BB:CC:DD:EE:FF>192.168.1.100<",
			expected: []client.DHCPStaticEntry{
				{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100"},
			},
		},
		{
			name:     "missing separator",
			input:    "<AA:BB:CC:DD:EE:FF",
			expected: nil,
		},
		{
			name:  "empty fields",
			input: "<>192.168.1.100",
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
				if result[i].MAC != e.MAC || result[i].IP != e.IP {
					t.Errorf("entry %d: expected %+v, got %+v", i, e, result[i])
				}
			}
		})
	}
}

func TestDHCPStaticListRoundTrip(t *testing.T) {
	t.Parallel()

	entries := []client.DHCPStaticEntry{
		{MAC: "AA:BB:CC:DD:EE:FF", IP: "192.168.1.100"},
		{MAC: "11:22:33:44:55:66", IP: "192.168.1.101"},
		{MAC: "DE:AD:BE:EF:CA:FE", IP: "192.168.1.200"},
	}

	serialized := client.SerializeDHCPStaticList(entries)
	parsed := client.ParseDHCPStaticList(serialized)

	if len(parsed) != len(entries) {
		t.Fatalf("round-trip: expected %d entries, got %d", len(entries), len(parsed))
	}

	for i, e := range entries {
		if parsed[i].MAC != e.MAC || parsed[i].IP != e.IP {
			t.Errorf("round-trip entry %d: expected %+v, got %+v", i, e, parsed[i])
		}
	}
}

func TestParseDHCPHostnames(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		expected map[string]string
	}{
		{
			name:     "empty",
			input:    "",
			expected: map[string]string{},
		},
		{
			name:  "single",
			input: "<AA:BB:CC:DD:EE:FF>homeserver",
			expected: map[string]string{
				"AA:BB:CC:DD:EE:FF": "homeserver",
			},
		},
		{
			name:  "multiple",
			input: "<AA:BB:CC:DD:EE:FF>homeserver<11:22:33:44:55:66>nas",
			expected: map[string]string{
				"AA:BB:CC:DD:EE:FF": "homeserver",
				"11:22:33:44:55:66": "nas",
			},
		},
		{
			name:  "empty hostname value",
			input: "<AA:BB:CC:DD:EE:FF>",
			expected: map[string]string{
				"AA:BB:CC:DD:EE:FF": "",
			},
		},
		{
			name:     "missing separator",
			input:    "<AA:BB:CC:DD:EE:FF",
			expected: map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			result := client.ParseDHCPHostnames(tt.input)

			if len(result) != len(tt.expected) {
				t.Fatalf("expected %d entries, got %d", len(tt.expected), len(result))
			}

			for mac, hostname := range tt.expected {
				if result[mac] != hostname {
					t.Errorf("MAC %s: expected %s, got %s", mac, hostname, result[mac])
				}
			}
		})
	}
}

func TestSerializeDHCPHostnamesSkipsEmpty(t *testing.T) {
	t.Parallel()

	result := client.SerializeDHCPHostnames(map[string]string{
		"AA:BB:CC:DD:EE:FF": "",
		"11:22:33:44:55:66": "nas",
	})

	if !strings.Contains(result, "<11:22:33:44:55:66>nas") {
		t.Errorf("expected result to contain nas entry, got %q", result)
	}

	if strings.Contains(result, "AA:BB:CC:DD:EE:FF") {
		t.Errorf("expected result to NOT contain empty-hostname MAC, got %q", result)
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
			input: "<HTTP>80>192.168.1.100>80>tcp",
			expected: []client.PortForwardEntry{
				{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp"},
			},
		},
		{
			name:  "single rule with source",
			input: "<HTTP>80>192.168.1.100>80>tcp>10.0.0.1",
			expected: []client.PortForwardEntry{
				{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp", SourceIP: "10.0.0.1"},
			},
		},
		{
			name:  "multiple rules",
			input: "<HTTP>80>192.168.1.100>80>tcp<SSH>2222>192.168.1.50>22>tcp",
			expected: []client.PortForwardEntry{
				{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp"},
				{Name: "SSH", ExternalPort: "2222", InternalIP: "192.168.1.50", InternalPort: "22", Protocol: "tcp"},
			},
		},
		{
			name:     "too few fields",
			input:    "<HTTP>80>192.168.1.100>80",
			expected: nil,
		},
		{
			name:  "extra fields beyond source",
			input: "<HTTP>80>192.168.1.100>80>tcp>10.0.0.1>extra",
			expected: []client.PortForwardEntry{
				{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp", SourceIP: "10.0.0.1"},
			},
		},
		{
			name:  "empty name",
			input: "<>80>192.168.1.100>80>tcp",
			expected: []client.PortForwardEntry{
				{Name: "", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp"},
			},
		},
		{
			name:  "port ranges",
			input: "<Game>27015:27020>192.168.1.200>27015:27020>udp",
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
				r := result[i]
				if r.Name != e.Name || r.ExternalPort != e.ExternalPort || r.InternalIP != e.InternalIP ||
					r.InternalPort != e.InternalPort || r.Protocol != e.Protocol || r.SourceIP != e.SourceIP {
					t.Errorf("entry %d: expected %+v, got %+v", i, e, r)
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

	serialized := client.SerializeVTSRuleList(entries)
	parsed := client.ParseVTSRuleList(serialized)

	if len(parsed) != len(entries) {
		t.Fatalf("round-trip: expected %d entries, got %d", len(entries), len(parsed))
	}

	for i, e := range entries {
		r := parsed[i]
		if r.Name != e.Name || r.ExternalPort != e.ExternalPort || r.InternalIP != e.InternalIP ||
			r.InternalPort != e.InternalPort || r.Protocol != e.Protocol || r.SourceIP != e.SourceIP {
			t.Errorf("round-trip entry %d: expected %+v, got %+v", i, e, r)
		}
	}
}

func TestDHCPHostnamesRoundTrip(t *testing.T) {
	t.Parallel()

	original := map[string]string{
		"AA:BB:CC:DD:EE:FF": "server",
		"11:22:33:44:55:66": "nas",
	}

	serialized := client.SerializeDHCPHostnames(original)
	parsed := client.ParseDHCPHostnames(serialized)

	if len(parsed) != len(original) {
		t.Fatalf("round-trip: expected %d entries, got %d", len(original), len(parsed))
	}

	for mac, hostname := range original {
		if parsed[mac] != hostname {
			t.Errorf("round-trip MAC %s: expected %q, got %q", mac, hostname, parsed[mac])
		}
	}
}

func TestVTSRuleListRoundTripMixed(t *testing.T) {
	t.Parallel()

	entries := []client.PortForwardEntry{
		{Name: "HTTP", ExternalPort: "80", InternalIP: "192.168.1.100", InternalPort: "80", Protocol: "tcp"},
		{Name: "SSH", ExternalPort: "22", InternalIP: "192.168.1.50", InternalPort: "22", Protocol: "tcp", SourceIP: "10.0.0.1"},
	}

	serialized := client.SerializeVTSRuleList(entries)
	parsed := client.ParseVTSRuleList(serialized)

	if len(parsed) != len(entries) {
		t.Fatalf("round-trip: expected %d entries, got %d", len(entries), len(parsed))
	}

	for i, e := range entries {
		r := parsed[i]
		if r.Name != e.Name || r.ExternalPort != e.ExternalPort || r.InternalIP != e.InternalIP ||
			r.InternalPort != e.InternalPort || r.Protocol != e.Protocol || r.SourceIP != e.SourceIP {
			t.Errorf("round-trip entry %d: expected %+v, got %+v", i, e, r)
		}
	}
}
