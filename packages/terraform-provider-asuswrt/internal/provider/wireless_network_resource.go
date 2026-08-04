package provider

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/int64planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/shepherdjerred/monorepo/packages/terraform-provider-asuswrt/internal/client"
)

var (
	_ resource.Resource                = &wirelessNetworkResource{}
	_ resource.ResourceWithConfigure   = &wirelessNetworkResource{}
	_ resource.ResourceWithImportState = &wirelessNetworkResource{}
)

type wirelessNetworkResource struct {
	client *client.Client
}

type wirelessNetworkResourceModel struct {
	ID            types.String `tfsdk:"id"`
	Band          types.Int64  `tfsdk:"band"`
	SSID          types.String `tfsdk:"ssid"`
	AuthMode      types.String `tfsdk:"auth_mode"`
	Crypto        types.String `tfsdk:"crypto"`
	WPAPassphrase types.String `tfsdk:"wpa_passphrase"`
	Channel       types.Int64  `tfsdk:"channel"`
	Bandwidth     types.Int64  `tfsdk:"bandwidth"`
	Hidden        types.Bool   `tfsdk:"hidden"`
}

// NewWirelessNetworkResource returns a new wireless network resource.
func NewWirelessNetworkResource() resource.Resource {
	return &wirelessNetworkResource{}
}

func (r *wirelessNetworkResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_wireless_network"
}

func (r *wirelessNetworkResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages wireless network settings for a specific radio band.",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Description: "Resource identifier (wl{band}).",
				Computed:    true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
			"band": schema.Int64Attribute{
				Description: "Radio band index: 0 = 2.4GHz, 1 = 5GHz.",
				Required:    true,
				PlanModifiers: []planmodifier.Int64{
					int64planmodifier.RequiresReplace(),
				},
			},
			"ssid": schema.StringAttribute{
				Description: "Wireless network name.",
				Required:    true,
			},
			"auth_mode": schema.StringAttribute{
				Description: "Authentication mode: open, psk, psk2, pskpsk2, sae, psk2sae, wpa2, owe.",
				Required:    true,
			},
			"crypto": schema.StringAttribute{
				Description: "Encryption type: aes, tkip+aes.",
				Optional:    true,
				Computed:    true,
			},
			"wpa_passphrase": schema.StringAttribute{
				Description: "WPA pre-shared key. Write-only: never read back from the router, so it is not populated on import. Omit it from tracked config to keep plans clean.",
				Optional:    true,
				Sensitive:   true,
			},
			"channel": schema.Int64Attribute{
				Description: "Channel number. 0 = auto.",
				Optional:    true,
				Computed:    true,
			},
			"bandwidth": schema.Int64Attribute{
				Description: "Channel bandwidth: 0=auto, 1=20MHz, 2=40MHz, 3/4=80MHz, 5=160MHz.",
				Optional:    true,
				Computed:    true,
			},
			"hidden": schema.BoolAttribute{
				Description: "Hide SSID from broadcast.",
				Optional:    true,
				Computed:    true,
			},
		},
	}
}

func (r *wirelessNetworkResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}

	c, ok := req.ProviderData.(*client.Client)
	if !ok {
		resp.Diagnostics.AddError("Unexpected provider data type", fmt.Sprintf("Expected *client.Client, got %T", req.ProviderData))

		return
	}

	r.client = c
}

func (r *wirelessNetworkResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan wirelessNetworkResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	band := int(plan.Band.ValueInt64())
	plan.ID = types.StringValue(fmt.Sprintf("wl%d", band))

	if err := r.applyWireless(ctx, band, &plan); err != nil {
		resp.Diagnostics.AddError("Failed to configure wireless", err.Error())

		return
	}

	// Optional+Computed attributes the config omitted are still Unknown after
	// applyWireless. Terraform requires every attribute to be known after
	// apply, so read the router back to resolve them to their real (or null)
	// value.
	resp.Diagnostics.Append(r.readWireless(ctx, band, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *wirelessNetworkResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state wirelessNetworkResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	band := int(state.Band.ValueInt64())

	resp.Diagnostics.Append(r.readWireless(ctx, band, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *wirelessNetworkResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan wirelessNetworkResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	band := int(plan.Band.ValueInt64())
	plan.ID = types.StringValue(fmt.Sprintf("wl%d", band))

	if err := r.applyWireless(ctx, band, &plan); err != nil {
		resp.Diagnostics.AddError("Failed to configure wireless", err.Error())

		return
	}

	resp.Diagnostics.Append(r.readWireless(ctx, band, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

// readWireless populates model from the router's current NVRAM values for the
// given band. Used by Read to refresh state, and by Create/Update to resolve
// Computed attributes the plan left Unknown into a known value (the router's
// actual value, or null when the router has none). WPA passphrase is
// write-only; it is never read back to avoid state drift.
func (r *wirelessNetworkResource) readWireless(ctx context.Context, band int, model *wirelessNetworkResourceModel) diag.Diagnostics {
	var diags diag.Diagnostics

	prefix := fmt.Sprintf("wl%d_", band)

	keys := []string{
		prefix + "ssid",
		prefix + "auth_mode_x",
		prefix + "crypto",
		prefix + "wpa_psk",
		prefix + "chanspec",
		prefix + "bw",
		prefix + "closed",
	}

	result, err := r.client.NvramGet(ctx, keys)
	if err != nil {
		diags.AddError("Failed to read wireless settings", err.Error())

		return diags
	}

	model.SSID = types.StringValue(result[prefix+"ssid"])
	model.AuthMode = types.StringValue(result[prefix+"auth_mode_x"])

	readOptionalString(&model.Crypto, result, prefix+"crypto")
	readOptionalInt64(&model.Channel, result, prefix+"chanspec", parseChannel)
	readOptionalInt64FromString(&model.Bandwidth, result, prefix+"bw")
	readOptionalBoolFromFlag(&model.Hidden, result, prefix+"closed")

	return diags
}

func (r *wirelessNetworkResource) Delete(_ context.Context, _ resource.DeleteRequest, _ *resource.DeleteResponse) {
	// Wireless radios cannot be deleted; this is a no-op.
}

// ImportState imports a wireless band by its index (e.g. "0", "1", "2").
// Read then populates the remaining attributes from the router.
func (r *wirelessNetworkResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	band, err := strconv.ParseInt(strings.TrimSpace(req.ID), 10, 64)
	if err != nil {
		resp.Diagnostics.AddError(
			"Invalid import ID",
			fmt.Sprintf("Wireless import ID must be a band index (e.g. 0, 1, 2); got %q", req.ID),
		)

		return
	}

	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("band"), band)...)
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("id"), fmt.Sprintf("wl%d", band))...)
}

// applyWireless writes per-band wireless NVRAM. NOTE: the write path is
// firmware-dependent and not verified against real hardware — reads/imports are
// reliable, but applies are not. On 3006 the UI writes band-named keys
// (2g1_*/5g1_*) rather than wl<band>_*, wl_bw codes differ across firmwares, and
// SAE/WPA3 needs wl_mfp. See docs/todos/asuswrt-wireless-write-path.md before
// relying on wireless apply.
func (r *wirelessNetworkResource) applyWireless(ctx context.Context, band int, plan *wirelessNetworkResourceModel) error {
	prefix := fmt.Sprintf("wl%d_", band)
	values := map[string]string{
		prefix + "ssid":        plan.SSID.ValueString(),
		prefix + "auth_mode_x": plan.AuthMode.ValueString(),
	}

	setOptionalString(values, prefix+"crypto", plan.Crypto)
	setOptionalString(values, prefix+"wpa_psk", plan.WPAPassphrase)

	if err := r.setChanspec(ctx, values, band, prefix, plan); err != nil {
		return err
	}

	if !plan.Bandwidth.IsNull() && !plan.Bandwidth.IsUnknown() {
		values[prefix+"bw"] = strconv.FormatInt(plan.Bandwidth.ValueInt64(), 10)
	}

	if !plan.Hidden.IsNull() && !plan.Hidden.IsUnknown() {
		values[prefix+"closed"] = boolToFlag(plan.Hidden.ValueBool())
	}

	if err := r.client.NvramSet(ctx, values, client.ServiceWireless); err != nil {
		return fmt.Errorf("setting wireless NVRAM: %w", err)
	}

	return nil
}

// setChanspec writes the channel+width chanspec when a channel is configured.
// The chanspec encodes channel and width together, so both are needed. When
// bandwidth is omitted (Optional+Computed → Unknown/null), defaulting it to 0
// would write a bare channel that the firmware reads as auto width, silently
// narrowing the radio; instead read the router's current width so the configured
// channel is still applied, at the existing width. An explicitly configured
// width (including 0 = auto) is honored as-is.
func (r *wirelessNetworkResource) setChanspec(ctx context.Context, values map[string]string, band int, prefix string, plan *wirelessNetworkResourceModel) error {
	if plan.Channel.IsNull() || plan.Channel.IsUnknown() {
		return nil
	}

	bandwidth, err := r.resolveBandwidthCode(ctx, band, plan.Bandwidth)
	if err != nil {
		return err
	}

	chanspec, err := formatChanspec(int(plan.Channel.ValueInt64()), bandwidth)
	if err != nil {
		return fmt.Errorf("formatting chanspec: %w", err)
	}

	values[prefix+"chanspec"] = chanspec

	return nil
}

// resolveBandwidthCode returns the wl_bw code to pair with a channel write: the
// planned value when known, otherwise the router's current width, so an omitted
// Optional+Computed bandwidth does not narrow the radio.
func (r *wirelessNetworkResource) resolveBandwidthCode(ctx context.Context, band int, bandwidth types.Int64) (int, error) {
	if !bandwidth.IsNull() && !bandwidth.IsUnknown() {
		return int(bandwidth.ValueInt64()), nil
	}

	key := fmt.Sprintf("wl%d_bw", band)

	cur, err := r.client.NvramGetSingle(ctx, key)
	if err != nil {
		return 0, fmt.Errorf("reading current bandwidth %s: %w", key, err)
	}

	if cur == "" {
		return 0, nil
	}

	code, err := strconv.Atoi(cur)
	if err != nil {
		return 0, fmt.Errorf("parsing current bandwidth %s=%q: %w", key, cur, err)
	}

	return code, nil
}

// setOptionalString adds a string attribute to the values map if it is set.
func setOptionalString(values map[string]string, key string, attr types.String) {
	if !attr.IsNull() && !attr.IsUnknown() {
		values[key] = attr.ValueString()
	}
}

// readOptionalInt64 reads an NVRAM value and applies a transform to get an
// int64. Populates from a non-empty value regardless of whether the target is
// null (so imported/Computed-Unknown state reflects the router); an empty
// NVRAM value clears the target to null unless it's already null, so a value
// cleared on the router (rather than merely unconfigured) surfaces as drift
// instead of leaving a stale target.
func readOptionalInt64(target *types.Int64, result map[string]string, key string, transform func(string) int) {
	v, ok := result[key]
	if !ok {
		return
	}

	if v != "" {
		*target = types.Int64Value(int64(transform(v)))
	} else if !target.IsNull() {
		*target = types.Int64Null()
	}
}

// readOptionalInt64FromString reads a numeric string from NVRAM into an int64
// attribute, applying the same empty-clears-stale-state behavior as
// readOptionalInt64.
func readOptionalInt64FromString(target *types.Int64, result map[string]string, key string) {
	v, ok := result[key]
	if !ok {
		return
	}

	if v == "" {
		if !target.IsNull() {
			*target = types.Int64Null()
		}

		return
	}

	if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
		*target = types.Int64Value(parsed)
	}
}

// readOptionalBoolFromFlag reads a "0"/"1" NVRAM flag into a bool attribute,
// applying the same empty-clears-stale-state behavior as readOptionalInt64.
func readOptionalBoolFromFlag(target *types.Bool, result map[string]string, key string) {
	v, ok := result[key]
	if !ok {
		return
	}

	if v != "" {
		*target = types.BoolValue(v == "1")
	} else if !target.IsNull() {
		*target = types.BoolNull()
	}
}

// boolToFlag converts a bool to "0" or "1".
func boolToFlag(b bool) string {
	if b {
		return "1"
	}

	return "0"
}

// parseChannel extracts the channel number from a chanspec string like "36/80" or "0".
func parseChannel(chanspec string) int {
	if chanspec == "0" {
		return 0
	}

	idx := strings.Index(chanspec, "/")
	channelStr := chanspec
	if idx >= 0 {
		channelStr = chanspec[:idx]
	}

	ch, err := strconv.Atoi(channelStr)
	if err != nil {
		return 0
	}

	return ch
}

// formatChanspec creates a chanspec string from channel and bandwidth. It
// returns an error for bandwidth codes it cannot model, so an unsupported
// value fails the apply loudly instead of silently writing a bare channel
// (which would narrow the radio to the firmware default — e.g. turning a
// 149/80 chanspec into 149).
func formatChanspec(channel, bandwidth int) (string, error) {
	if channel == 0 {
		return "0", nil
	}

	bwStr, err := bandwidthToString(bandwidth)
	if err != nil {
		return "", err
	}
	if bwStr == "" {
		return strconv.Itoa(channel), nil
	}

	return strconv.Itoa(channel) + "/" + bwStr, nil
}

// bandwidthToString converts the wl_bw bandwidth code to the chanspec suffix.
// Code 0 (auto) maps to an empty suffix (a bare channel, which the firmware
// reads as auto width). On this hardware the 80 MHz radio uses code 3 (some
// firmwares report 4), so both are accepted. Any other code returns an error
// rather than a silent empty suffix, which would corrupt the chanspec.
func bandwidthToString(bw int) (string, error) {
	switch bw {
	case 0:
		return "", nil
	case 1:
		return "20", nil
	case 2:
		return "40", nil
	case 3, 4:
		return "80", nil
	case 5:
		return "160", nil
	default:
		return "", fmt.Errorf("unsupported wl_bw bandwidth code %d (expected 0=auto, 1=20MHz, 2=40MHz, 3/4=80MHz, 5=160MHz)", bw)
	}
}
