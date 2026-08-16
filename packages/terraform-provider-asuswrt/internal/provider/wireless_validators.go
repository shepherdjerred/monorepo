package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
)

// bandwidthValidator rejects wl_bw bandwidth codes this provider cannot model.
//
// The configured code is written straight to wl<band>_bw as well as feeding the
// chanspec suffix, and the chanspec path only encodes a width when a channel is
// actually being set. Without a plan-time check an arbitrary code therefore
// reached the router unexamined — "channel = 0, bandwidth = 999" wrote
// wl_bw=999 and reported success.
//
// bandwidthToString is the single source of truth for which codes are
// supported, so validation cannot drift from encoding.
type bandwidthValidator struct{}

func (v bandwidthValidator) Description(_ context.Context) string {
	return "value must be a supported wl_bw bandwidth code (0=auto, 1=20MHz, 2=40MHz, 3/4=80MHz, 5=160MHz)"
}

func (v bandwidthValidator) MarkdownDescription(ctx context.Context) string {
	return v.Description(ctx)
}

func (v bandwidthValidator) ValidateInt64(
	_ context.Context,
	req validator.Int64Request,
	resp *validator.Int64Response,
) {
	if req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() {
		return
	}

	if _, err := bandwidthToString(int(req.ConfigValue.ValueInt64())); err != nil {
		resp.Diagnostics.AddAttributeError(req.Path, "Invalid wireless bandwidth", err.Error())
	}
}

// int64RangeValidator rejects values outside an inclusive range.
//
// It guards the two other wireless attributes that are interpolated straight
// into NVRAM keys or values:
//
//   - band becomes the wl<band>_* key prefix, so a negative or absurd index
//     addresses a radio that does not exist (wl-1_ssid) and an apply would
//     write a whole set of junk keys. ImportState verifies the radio exists
//     against the router; a range check is the plan-time equivalent for
//     configs, which cannot be existence-checked without a live call.
//   - channel is interpolated into the chanspec. formatChanspec would happily
//     emit "1000/20", but chanspecPattern only models 1-3 digit channels, so
//     every later refresh would fail with "unparseable chanspec" — the write
//     path must not be able to produce a value the read path rejects.
type int64RangeValidator struct {
	min     int64
	max     int64
	summary string
}

func (v int64RangeValidator) Description(_ context.Context) string {
	return fmt.Sprintf("value must be between %d and %d inclusive", v.min, v.max)
}

func (v int64RangeValidator) MarkdownDescription(ctx context.Context) string {
	return v.Description(ctx)
}

func (v int64RangeValidator) ValidateInt64(
	_ context.Context,
	req validator.Int64Request,
	resp *validator.Int64Response,
) {
	if req.ConfigValue.IsNull() || req.ConfigValue.IsUnknown() {
		return
	}

	got := req.ConfigValue.ValueInt64()
	if got < v.min || got > v.max {
		resp.Diagnostics.AddAttributeError(
			req.Path,
			v.summary,
			fmt.Sprintf("Value must be between %d and %d inclusive; got %d.", v.min, v.max, got),
		)
	}
}
