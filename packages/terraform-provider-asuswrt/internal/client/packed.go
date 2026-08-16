package client

import (
	"fmt"
	"strings"
)

// Asuswrt returns packed list-valued NVRAM entries from appGet.cgi with HTML
// numeric character references as delimiters: each entry is prefixed by
// "&#60" (encodes '<') and its fields are separated by "&#62" (encodes '>').
// Parsing and the state-side serializer operate on that representation so an
// untouched read round-trips byte-for-byte.
//
// apply.cgi is asymmetric: it expects the literal '<'/'>' format built by the
// firmware's own web UI. Sending the appGet.cgi representation writes the '&'
// as data, so the next read returns "&#38#60"/"&#38#62" and the router no longer
// sees delimiters. Encode*ForWrite performs that boundary conversion.
const (
	packedEntryDelim      = "&#60" // appGet.cgi representation of '<'
	packedFieldDelim      = "&#62" // appGet.cgi representation of '>'
	packedWriteEntryDelim = "<"    // apply.cgi representation
	packedWriteFieldDelim = ">"    // apply.cgi representation
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

// PackedDelimiters returns every read- or write-side delimiter that cannot
// appear inside a modeled packed-list field.
//
// The format has no escaping, so a field value containing any delimiter cannot
// be represented. Callers that accept user input destined for a packed list
// must reject such values before they reach serialization.
func PackedDelimiters() []string {
	return []string{packedEntryDelim, packedFieldDelim, packedWriteEntryDelim, packedWriteFieldDelim}
}

// splitPackedEntries splits a packed NVRAM value into per-entry field slices.
//
// A well-formed value is empty or begins with the entry delimiter, so exactly
// one empty segment — the leading one — is expected. Every other shape is
// rejected rather than normalized away: a missing leading delimiter, a repeated
// delimiter, and a trailing delimiter all used to parse "successfully", and the
// next mutation would then rewrite the list in a different encoding than the
// router supplied. Silently re-encoding NVRAM we did not understand is how an
// unrecognized entry becomes an active one.
func splitPackedEntries(raw string) ([][]string, error) {
	if raw == "" {
		return nil, nil
	}

	if !strings.HasPrefix(raw, packedEntryDelim) {
		return nil, fmt.Errorf(
			"value does not begin with the entry delimiter %q: %q", packedEntryDelim, raw,
		)
	}

	var entries [][]string

	for i, part := range strings.Split(raw, packedEntryDelim) {
		if part == "" {
			// Index 0 is the empty segment before the leading delimiter, which
			// the prefix check above guarantees is present.
			if i == 0 {
				continue
			}

			return nil, fmt.Errorf("empty entry at position %d: %q", i, raw)
		}

		entries = append(entries, strings.Split(part, packedFieldDelim))
	}

	return entries, nil
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
// ModeledFields records how many of the modeled fields the router actually
// supplied. The trailing ones are optional, so firmware may send a 2-field
// <MAC>IP entry; re-emitting it as <MAC>IP>> would change the packed shape of
// an entry the operator never touched, on any unrelated lease mutation. Zero
// means the entry was built by this provider rather than parsed, in which case
// serialization uses the full modeled layout.
//
// Callers updating a lease must overwrite the modeled fields on the parsed
// entry rather than assign a freshly constructed one over it, or
// Extra/HasExtra/ModeledFields revert to their zero values and the router loses
// those fields or has its layout rewritten.
type DHCPStaticEntry struct {
	MAC           string
	IP            string
	DNS           string
	Hostname      string
	Extra         string
	HasExtra      bool
	ModeledFields int
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

	split, err := splitPackedEntries(raw)
	if err != nil {
		return nil, fmt.Errorf("parsing dhcp_staticlist: %w", err)
	}

	for i, fields := range split {
		if len(fields) < dhcpRequiredFields {
			return nil, fmt.Errorf(
				"parsing dhcp_staticlist: entry %d has %d field(s), need at least %d: %q",
				i, len(fields), dhcpRequiredFields, strings.Join(fields, packedFieldDelim),
			)
		}

		entry := DHCPStaticEntry{MAC: fields[0], IP: fields[1], ModeledFields: min(len(fields), dhcpModeledFields)}
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
// Entries this provider created emit the full 4-field <MAC>IP>DNS>Hostname
// layout so they match the router's native format (<MAC>IP>>); parsed entries
// keep the field count the router supplied, plus any preserved trailing fields.
func SerializeDHCPStaticList(entries []DHCPStaticEntry) string {
	var b strings.Builder

	for _, e := range entries {
		modeled := []string{e.MAC, e.IP, e.DNS, e.Hostname}
		n := modeledFieldCount(e.ModeledFields, dhcpModeledFields, modeled, e.HasExtra)

		fields := modeled[:n:n]
		if e.HasExtra {
			fields = append(fields, e.Extra)
		}

		writePackedEntry(&b, fields...)
	}

	return b.String()
}

// EncodeDHCPStaticListForWrite returns the literal-delimiter representation
// apply.cgi expects. appGet.cgi exposes the same NVRAM value with the angle
// brackets HTML-encoded, which SerializeDHCPStaticList deliberately preserves.
func EncodeDHCPStaticListForWrite(entries []DHCPStaticEntry) string {
	return encodePackedListForWrite(SerializeDHCPStaticList(entries))
}

// modeledFieldCount decides how many modeled fields to emit for one entry.
//
// It preserves the count the router supplied so an untouched short entry
// round-trips byte-for-byte, widens it to cover any optional field this
// provider has since populated, and falls back to the full layout for an entry
// that was never parsed (parsed == 0) or that carries unmodeled trailing
// fields, where a short prefix would shift them out of position.
func modeledFieldCount(parsed, full int, modeled []string, hasExtra bool) int {
	if hasExtra || parsed <= 0 || parsed > full {
		return full
	}

	for i := full - 1; i >= parsed; i-- {
		if modeled[i] != "" {
			return i + 1
		}
	}

	return parsed
}

// PortForwardEntry represents a single port forward rule.
//
// Extra and HasExtra preserve fields past the modeled six, value and presence
// respectively, for the same reasons as on DHCPStaticEntry: port-forward
// mutations rewrite the entire list, and an empty trailing field is a field.
//
// ModeledFields records how many modeled fields the router supplied, for the
// same reason as on DHCPStaticEntry: source IP is optional, so a 5-field rule
// must not be rewritten with a trailing delimiter it never had.
//
// Callers updating a rule must overwrite the modeled fields on the parsed entry
// rather than assign a freshly constructed one over it. A fresh entry carries
// zero-valued Extra/HasExtra/ModeledFields, which erases the router's trailing
// fields or rewrites its layout on the next write.
type PortForwardEntry struct {
	Name          string
	ExternalPort  string
	InternalIP    string
	InternalPort  string
	Protocol      string
	SourceIP      string
	Extra         string
	HasExtra      bool
	ModeledFields int
}

// ParseVTSRuleList parses the vts_rulelist NVRAM value.
// Format: <name>ext_port>int_ip>int_port>proto>src_ip per entry (src often empty).
//
// Like ParseDHCPStaticList, a short entry is an error rather than a skip,
// because port-forward mutations rewrite the entire list.
func ParseVTSRuleList(raw string) ([]PortForwardEntry, error) {
	var entries []PortForwardEntry

	split, err := splitPackedEntries(raw)
	if err != nil {
		return nil, fmt.Errorf("parsing vts_rulelist: %w", err)
	}

	for i, fields := range split {
		if len(fields) < vtsRequiredFields {
			return nil, fmt.Errorf(
				"parsing vts_rulelist: entry %d has %d field(s), need at least %d: %q",
				i, len(fields), vtsRequiredFields, strings.Join(fields, packedFieldDelim),
			)
		}

		entry := PortForwardEntry{
			Name:          fields[0],
			ExternalPort:  fields[1],
			InternalIP:    fields[2],
			InternalPort:  fields[3],
			Protocol:      fields[4],
			ModeledFields: min(len(fields), vtsModeledFields),
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
// Entries this provider created emit the full 6-field layout (trailing src
// field, empty when unset) to match the router's native format, which keeps a
// trailing delimiter after the protocol even when no source IP restriction is
// set; parsed entries keep the field count the router supplied, plus any
// preserved trailing fields.
func SerializeVTSRuleList(entries []PortForwardEntry) string {
	var b strings.Builder

	for i := range entries {
		e := &entries[i]
		modeled := []string{e.Name, e.ExternalPort, e.InternalIP, e.InternalPort, e.Protocol, e.SourceIP}
		n := modeledFieldCount(e.ModeledFields, vtsModeledFields, modeled, e.HasExtra)

		fields := modeled[:n:n]
		if e.HasExtra {
			fields = append(fields, e.Extra)
		}

		writePackedEntry(&b, fields...)
	}

	return b.String()
}

// EncodeVTSRuleListForWrite is the port-forward equivalent of
// EncodeDHCPStaticListForWrite.
func EncodeVTSRuleListForWrite(entries []PortForwardEntry) string {
	return encodePackedListForWrite(SerializeVTSRuleList(entries))
}

func encodePackedListForWrite(value string) string {
	return strings.NewReplacer(
		packedEntryDelim, packedWriteEntryDelim,
		packedFieldDelim, packedWriteFieldDelim,
	).Replace(value)
}
