package client

import (
	"strings"
)

// DHCPStaticEntry represents a single DHCP static lease.
type DHCPStaticEntry struct {
	MAC      string
	IP       string
	Hostname string
}

// ParseDHCPStaticList parses the dhcp_staticlist NVRAM value.
// Format: <MAC1>IP1<MAC2>IP2.
func ParseDHCPStaticList(raw string) []DHCPStaticEntry {
	if raw == "" {
		return nil
	}

	var entries []DHCPStaticEntry

	// Split on '<' to get entries; first element is empty.
	parts := strings.Split(raw, "<")
	for _, part := range parts {
		if part == "" {
			continue
		}

		// Each part is "MAC>IP".
		fields := strings.SplitN(part, ">", 2)
		if len(fields) != 2 {
			continue
		}

		entries = append(entries, DHCPStaticEntry{
			MAC: fields[0],
			IP:  fields[1],
		})
	}

	return entries
}

// SerializeDHCPStaticList serializes DHCP static entries back to NVRAM format.
func SerializeDHCPStaticList(entries []DHCPStaticEntry) string {
	var b strings.Builder

	for _, e := range entries {
		b.WriteByte('<')
		b.WriteString(e.MAC)
		b.WriteByte('>')
		b.WriteString(e.IP)
	}

	return b.String()
}

// ParseDHCPHostnames parses the dhcp_hostnames NVRAM value.
// Format: <MAC1>hostname1<MAC2>hostname2.
func ParseDHCPHostnames(raw string) map[string]string {
	result := make(map[string]string)
	if raw == "" {
		return result
	}

	parts := strings.Split(raw, "<")
	for _, part := range parts {
		if part == "" {
			continue
		}

		fields := strings.SplitN(part, ">", 2)
		if len(fields) != 2 {
			continue
		}

		result[fields[0]] = fields[1]
	}

	return result
}

// SerializeDHCPHostnames serializes the hostname map back to NVRAM format.
func SerializeDHCPHostnames(hostnames map[string]string) string {
	var b strings.Builder

	for mac, hostname := range hostnames {
		if hostname == "" {
			continue
		}

		b.WriteByte('<')
		b.WriteString(mac)
		b.WriteByte('>')
		b.WriteString(hostname)
	}

	return b.String()
}

// PortForwardEntry represents a single port forward rule.
type PortForwardEntry struct {
	Name         string
	ExternalPort string
	InternalIP   string
	InternalPort string
	Protocol     string
	SourceIP     string
}

// ParseVTSRuleList parses the vts_rulelist NVRAM value.
// Format: <name>ext_port>int_ip>int_port>proto[>src_ip].
func ParseVTSRuleList(raw string) []PortForwardEntry {
	if raw == "" {
		return nil
	}

	var entries []PortForwardEntry

	parts := strings.Split(raw, "<")
	for _, part := range parts {
		if part == "" {
			continue
		}

		fields := strings.Split(part, ">")
		if len(fields) < 5 {
			continue
		}

		entry := PortForwardEntry{
			Name:         fields[0],
			ExternalPort: fields[1],
			InternalIP:   fields[2],
			InternalPort: fields[3],
			Protocol:     fields[4],
		}

		if len(fields) > 5 {
			entry.SourceIP = fields[5]
		}

		entries = append(entries, entry)
	}

	return entries
}

// SerializeVTSRuleList serializes port forward entries back to NVRAM format.
func SerializeVTSRuleList(entries []PortForwardEntry) string {
	var b strings.Builder

	for _, e := range entries {
		b.WriteByte('<')
		b.WriteString(e.Name)
		b.WriteByte('>')
		b.WriteString(e.ExternalPort)
		b.WriteByte('>')
		b.WriteString(e.InternalIP)
		b.WriteByte('>')
		b.WriteString(e.InternalPort)
		b.WriteByte('>')
		b.WriteString(e.Protocol)

		if e.SourceIP != "" {
			b.WriteByte('>')
			b.WriteString(e.SourceIP)
		}
	}

	return b.String()
}
