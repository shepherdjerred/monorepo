package client

import (
	"fmt"
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

// Minimum field counts for a well-formed entry. Trailing fields (DHCP DNS and
// hostname, port-forward source IP) are optional; anything shorter than these
// is not an entry this provider can round-trip.
const (
	dhcpRequiredFields = 2 // MAC, IP
	vtsRequiredFields  = 5 // name, external port, internal IP, internal port, protocol
)

// Field counts this provider models by name. Anything beyond these is retained
// verbatim in the entry's Extra so a rewrite cannot drop it.
const (
	dhcpModeledFields = 4 // MAC, IP, DNS, hostname
	vtsModeledFields  = 6 // the five required plus source IP
)

// Positions of the optional trailing fields within a modeled entry.
const (
	dhcpDNSField      = 2
	dhcpHostnameField = 3
	vtsSourceIPField  = 5
)

// PackedDelimiters returns the tokens that delimit packed NVRAM lists.
//
// The format has no escaping, so a field value containing either token cannot
// be represented. Callers that accept user input destined for a packed list
// must reject such values before they reach serialization.
func PackedDelimiters() []string {
	return []string{packedEntryDelim, packedFieldDelim}
}

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
//
// Extra holds any fields past the modeled four, already joined with the field
// delimiter, and is re-emitted verbatim. Firmware that adds a field must not
// lose it: every lease mutation rewrites the whole list, so an unmodeled
// trailing field that this provider dropped would be erased from the router.
// It is a string rather than a slice so the struct stays comparable.
//
// HasExtra records field *presence* independently of value. An entry ending in
// a bare delimiter has one trailing field whose value is empty, which Extra
// alone cannot distinguish from having no trailing field at all — and emitting
// the wrong one silently changes the packed shape.
//
// Callers updating a lease must overwrite the modeled fields on the parsed
// entry rather than assign a freshly constructed one over it, or Extra/HasExtra
// revert to their zero values and the router loses those fields.
type DHCPStaticEntry struct {
	MAC      string
	IP       string
	DNS      string
	Hostname string
	Extra    string
	HasExtra bool
}

// ParseDHCPStaticList parses the dhcp_staticlist NVRAM value.
// Format: <MAC>IP>DNS>Hostname per entry (DNS/Hostname often empty).
//
// An entry with fewer than the required fields is an error, never a skip.
// Every lease mutation serializes the whole parsed list back to NVRAM, so a
// silently dropped entry would be permanently deleted from the router by the
// next unrelated apply.
func ParseDHCPStaticList(raw string) ([]DHCPStaticEntry, error) {
	var entries []DHCPStaticEntry

	for i, fields := range splitPackedEntries(raw) {
		if len(fields) < dhcpRequiredFields {
			return nil, fmt.Errorf(
				"parsing dhcp_staticlist: entry %d has %d field(s), need at least %d: %q",
				i, len(fields), dhcpRequiredFields, strings.Join(fields, packedFieldDelim),
			)
		}

		entry := DHCPStaticEntry{MAC: fields[0], IP: fields[1]}
		if len(fields) > dhcpDNSField {
			entry.DNS = fields[dhcpDNSField]
		}

		if len(fields) > dhcpHostnameField {
			entry.Hostname = fields[dhcpHostnameField]
		}

		if len(fields) > dhcpModeledFields {
			entry.Extra = strings.Join(fields[dhcpModeledFields:], packedFieldDelim)
			entry.HasExtra = true
		}

		entries = append(entries, entry)
	}

	return entries, nil
}

// SerializeDHCPStaticList serializes DHCP static entries back to NVRAM format.
// Always emits the 4-field <MAC>IP>DNS>Hostname layout so that entries created
// without DNS/Hostname still match the router's native format (<MAC>IP>>), plus
// any preserved trailing fields.
func SerializeDHCPStaticList(entries []DHCPStaticEntry) string {
	var b strings.Builder

	for _, e := range entries {
		fields := []string{e.MAC, e.IP, e.DNS, e.Hostname}
		if e.HasExtra {
			fields = append(fields, e.Extra)
		}

		writePackedEntry(&b, fields...)
	}

	return b.String()
}

// PortForwardEntry represents a single port forward rule.
//
// Extra and HasExtra preserve fields past the modeled six, value and presence
// respectively, for the same reasons as on DHCPStaticEntry: port-forward
// mutations rewrite the entire list, and an empty trailing field is a field.
//
// Callers updating a rule must overwrite the modeled fields on the parsed entry
// rather than assign a freshly constructed one over it. A fresh entry carries
// zero-valued Extra/HasExtra, which erases the router's trailing fields on the
// next write.
type PortForwardEntry struct {
	Name         string
	ExternalPort string
	InternalIP   string
	InternalPort string
	Protocol     string
	SourceIP     string
	Extra        string
	HasExtra     bool
}

// ParseVTSRuleList parses the vts_rulelist NVRAM value.
// Format: <name>ext_port>int_ip>int_port>proto>src_ip per entry (src often empty).
//
// Like ParseDHCPStaticList, a short entry is an error rather than a skip,
// because port-forward mutations rewrite the entire list.
func ParseVTSRuleList(raw string) ([]PortForwardEntry, error) {
	var entries []PortForwardEntry

	for i, fields := range splitPackedEntries(raw) {
		if len(fields) < vtsRequiredFields {
			return nil, fmt.Errorf(
				"parsing vts_rulelist: entry %d has %d field(s), need at least %d: %q",
				i, len(fields), vtsRequiredFields, strings.Join(fields, packedFieldDelim),
			)
		}

		entry := PortForwardEntry{
			Name:         fields[0],
			ExternalPort: fields[1],
			InternalIP:   fields[2],
			InternalPort: fields[3],
			Protocol:     fields[4],
		}

		if len(fields) > vtsSourceIPField {
			entry.SourceIP = fields[vtsSourceIPField]
		}

		if len(fields) > vtsModeledFields {
			entry.Extra = strings.Join(fields[vtsModeledFields:], packedFieldDelim)
			entry.HasExtra = true
		}

		entries = append(entries, entry)
	}

	return entries, nil
}

// SerializeVTSRuleList serializes port forward entries back to NVRAM format.
// Always emits the 6-field layout (trailing src field, empty when unset) to
// match the router's native format, which keeps a trailing delimiter after the
// protocol even when no source IP restriction is set, plus any preserved
// trailing fields.
func SerializeVTSRuleList(entries []PortForwardEntry) string {
	var b strings.Builder

	for _, e := range entries {
		fields := []string{e.Name, e.ExternalPort, e.InternalIP, e.InternalPort, e.Protocol, e.SourceIP}
		if e.HasExtra {
			fields = append(fields, e.Extra)
		}

		writePackedEntry(&b, fields...)
	}

	return b.String()
}
