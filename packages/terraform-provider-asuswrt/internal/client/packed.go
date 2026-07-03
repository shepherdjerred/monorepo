package client

import (
	"strings"
)

// Asuswrt packs list-valued NVRAM entries using HTML numeric character
// references as delimiters rather than literal angle brackets: each entry is
// prefixed by "&#60" (encodes '<') and its fields are separated by "&#62"
// (encodes '>'). The router stores and returns the literal 4-character token
// strings — it does NOT emit real '<'/'>' bytes — so parsing/serializing must
// operate on these tokens to round-trip correctly against live hardware.
const (
	packedEntryDelim = "&#60" // '<' — separates/prefixes entries
	packedFieldDelim = "&#62" // '>' — separates fields within an entry
)

// splitPackedEntries splits a packed NVRAM value into per-entry field slices.
// The leading empty segment before the first "&#60" is dropped.
func splitPackedEntries(raw string) [][]string {
	if raw == "" {
		return nil
	}

	var entries [][]string

	for _, part := range strings.Split(raw, packedEntryDelim) {
		if part == "" {
			continue
		}

		entries = append(entries, strings.Split(part, packedFieldDelim))
	}

	return entries
}

// writePackedEntry appends one "&#60"-prefixed, "&#62"-delimited entry.
func writePackedEntry(b *strings.Builder, fields ...string) {
	b.WriteString(packedEntryDelim)
	b.WriteString(strings.Join(fields, packedFieldDelim))
}

// DHCPStaticEntry represents a single DHCP static lease.
//
// The live NVRAM layout on current firmware (3006 / 388) is a 4-field entry:
// <MAC>IP>DNS>Hostname. DNS and Hostname are preserved verbatim so that
// serialization round-trips the router's exact byte format and never clobbers
// per-client DNS or an inline hostname belonging to another entry.
type DHCPStaticEntry struct {
	MAC      string
	IP       string
	DNS      string
	Hostname string
}

// ParseDHCPStaticList parses the dhcp_staticlist NVRAM value.
// Format: <MAC>IP>DNS>Hostname per entry (DNS/Hostname often empty).
func ParseDHCPStaticList(raw string) []DHCPStaticEntry {
	var entries []DHCPStaticEntry

	for _, fields := range splitPackedEntries(raw) {
		if len(fields) < 2 {
			continue
		}

		entry := DHCPStaticEntry{MAC: fields[0], IP: fields[1]}
		if len(fields) > 2 {
			entry.DNS = fields[2]
		}

		if len(fields) > 3 {
			entry.Hostname = fields[3]
		}

		entries = append(entries, entry)
	}

	return entries
}

// SerializeDHCPStaticList serializes DHCP static entries back to NVRAM format.
// Always emits the 4-field <MAC>IP>DNS>Hostname layout so that entries created
// without DNS/Hostname still match the router's native format (<MAC>IP>>).
func SerializeDHCPStaticList(entries []DHCPStaticEntry) string {
	var b strings.Builder

	for _, e := range entries {
		writePackedEntry(&b, e.MAC, e.IP, e.DNS, e.Hostname)
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
// Format: <name>ext_port>int_ip>int_port>proto>src_ip per entry (src often empty).
func ParseVTSRuleList(raw string) []PortForwardEntry {
	var entries []PortForwardEntry

	for _, fields := range splitPackedEntries(raw) {
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
// Always emits the 6-field layout (trailing src field, empty when unset) to
// match the router's native format, which keeps a trailing delimiter after the
// protocol even when no source IP restriction is set.
func SerializeVTSRuleList(entries []PortForwardEntry) string {
	var b strings.Builder

	for _, e := range entries {
		writePackedEntry(&b, e.Name, e.ExternalPort, e.InternalIP, e.InternalPort, e.Protocol, e.SourceIP)
	}

	return b.String()
}
