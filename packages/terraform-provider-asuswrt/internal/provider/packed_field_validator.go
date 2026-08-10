package provider

import (
	"context"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/schema/validator"

	"github.com/shepherdjerred/monorepo/packages/terraform-provider-asuswrt/internal/client"
)

// packedFieldValidator rejects values containing the tokens Asuswrt uses to
// delimit packed NVRAM lists.
//
// Those lists are flat strings with no escape mechanism: the firmware's own
// parsers split on the literal "&#60" and "&#62" tokens, so a value carrying
// one is simply not representable. Serializing it anyway would shift every
// following field, or fabricate an entry, on the next read — and because a
// mutation rewrites the whole list, that corrupted shape gets written back to
// the router and can destroy unrelated rules.
//
// Escaping is not an option: any scheme we invented would be unknown to the
// firmware, which reads these same keys. Rejecting at plan time is the only
// way to keep what we write readable by the device.
type packedFieldValidator struct{}

func (v packedFieldValidator) Description(_ context.Context) string {
	return "value must not contain the packed NVRAM list delimiters"
}

func (v packedFieldValidator) MarkdownDescription(ctx context.Context) string {
	return v.Description(ctx)
}

func (v packedFieldValidator) ValidateString(
	_ context.Context,
	req validator.StringRequest,
	resp *validator.StringResponse,
) {
	if req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() {
		return
	}

	value := req.ConfigValue.ValueString()

	for _, delim := range client.PackedDelimiters() {
		if strings.Contains(value, delim) {
			resp.Diagnostics.AddAttributeError(
				req.Path,
				"Invalid packed NVRAM value",
				fmt.Sprintf(
					"Value contains %q, which the router uses to delimit fields in packed NVRAM lists. "+
						"The format has no escape mechanism, so storing this value would corrupt the list. Got: %q",
					delim, value,
				),
			)

			return
		}
	}
}

// packedFieldValidators returns the validator set for a string attribute whose
// value is stored in a packed NVRAM list.
func packedFieldValidators() []validator.String {
	return []validator.String{packedFieldValidator{}}
}
