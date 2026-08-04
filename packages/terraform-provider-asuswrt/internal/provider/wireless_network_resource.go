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

	// The config channel (null when the user omitted it) gates the chanspec
	// write; the plan value is Computed and would be non-null after refresh even
	// when unconfigured. See applyWireless.
	var config wirelessNetworkResourceModel

	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	band := int(plan.Band.ValueInt64())
	plan.ID = types.StringValue(fmt.Sprintf("wl%d", band))

	if err := r.applyWireless(ctx, band, &plan, config.Channel, config.Bandwidth); err != nil {
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

	// The config channel (null when the user omitted it) gates the chanspec
	// write, so an update that changes only e.g. ssid does not rewrite the
	// channel from the Computed-refreshed plan value. See applyWireless.
	var config wirelessNetworkResourceModel

	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	band := int(plan.Band.ValueInt64())
	plan.ID = types.StringValue(fmt.Sprintf("wl%d", band))

	if err := r.applyWireless(ctx, band, &plan, config.Channel, config.Bandwidth); err != nil {
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

	if err := readOptionalInt64(&model.Channel, result, prefix+"chanspec", parseChannel); err != nil {
		diags.AddError("Invalid wireless chanspec encoding", err.Error())

		return diags
	}

	if err := readOptionalInt64FromString(&model.Bandwidth, result, prefix+"bw"); err != nil {
		diags.AddError("Invalid wireless bandwidth encoding", err.Error())

		return diags
	}

	if err := readOptionalBoolFromFlag(&model.Hidden, result, prefix+"closed"); err != nil {
		diags.AddError("Invalid wireless hidden-flag encoding", err.Error())

		return diags
	}

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
func (r *wirelessNetworkResource) applyWireless(ctx context.Context, band int, plan *wirelessNetworkResourceModel, configuredChannel, configuredBandwidth types.Int64) error {
	prefix := fmt.Sprintf("wl%d_", band)
	values := map[string]string{
		prefix + "ssid":        plan.SSID.ValueString(),
		prefix + "auth_mode_x": plan.AuthMode.ValueString(),
	}

	setOptionalString(values, prefix+"crypto", plan.Crypto)
	setOptionalString(values, prefix+"wpa_psk", plan.WPAPassphrase)

	if err := r.setChanspec(ctx, values, band, prefix, configuredChannel, configuredBandwidth); err != nil {
		return err
	}

	// wl_bw is written only when bandwidth is configured; setChanspec keeps
	// wl_chanspec consistent with it (or with the router's current width when
	// bandwidth is omitted).
	if !configuredBandwidth.IsNull() && !configuredBandwidth.IsUnknown() {
		values[prefix+"bw"] = strconv.FormatInt(configuredBandwidth.ValueInt64(), 10)
	}

	if !plan.Hidden.IsNull() && !plan.Hidden.IsUnknown() {
		values[prefix+"closed"] = boolToFlag(plan.Hidden.ValueBool())
	}

	if err := r.client.NvramSet(ctx, values, client.ServiceWireless); err != nil {
		return fmt.Errorf("setting wireless NVRAM: %w", err)
	}

	return nil
}

// setChanspec writes the channel+width chanspec, but only when the channel or
// the bandwidth is actually configured (both are config values, null when the
// user omitted them — unlike the Computed-refreshed plan values, populated from
// the router after the first read). Gating on config means an update that
// changes only e.g. ssid never rewrites the chanspec.
//
// The chanspec encodes channel and width together, so whenever either is being
// changed we must write a complete, consistent chanspec — otherwise wl_bw and
// wl_chanspec could disagree (e.g. a bandwidth-only change writes wl_bw but
// leaves the old chanspec). The component the user did not configure is read
// back from the router: the current channel from wl<band>_chanspec or the
// current width from wl<band>_bw. An explicitly configured width (including
// 0 = auto) is honored as-is; a current chanspec form this provider can't model
// fails loudly rather than silently dropping the channel to auto.
func (r *wirelessNetworkResource) setChanspec(ctx context.Context, values map[string]string, band int, prefix string, channel, bandwidth types.Int64) error {
	channelSet := !channel.IsNull() && !channel.IsUnknown()
	bandwidthSet := !bandwidth.IsNull() && !bandwidth.IsUnknown()
	if !channelSet && !bandwidthSet {
		return nil
	}

	ch, err := r.resolveChannelNumber(ctx, band, channel)
	if err != nil {
		return err
	}

	bw, err := r.resolveBandwidthCode(ctx, band, bandwidth)
	if err != nil {
		return err
	}

	chanspec, err := formatChanspec(ch, bw)
	if err != nil {
		return fmt.Errorf("formatting chanspec: %w", err)
	}

	values[prefix+"chanspec"] = chanspec

	return nil
}

// resolveChannelNumber returns the channel to pair with a chanspec write: the
// configured value when set, otherwise the router's current channel parsed from
// wl<band>_chanspec. A non-empty current chanspec whose leading channel can't be
// parsed (e.g. a "6u"/"6l" sideband form) is an error rather than a silent
// fall-back to 0 (auto), which would drop the channel when only bandwidth
// changed.
func (r *wirelessNetworkResource) resolveChannelNumber(ctx context.Context, band int, channel types.Int64) (int, error) {
	if !channel.IsNull() && !channel.IsUnknown() {
		return int(channel.ValueInt64()), nil
	}

	key := fmt.Sprintf("wl%d_chanspec", band)

	cur, err := r.client.NvramGetSingle(ctx, key)
	if err != nil {
		return 0, fmt.Errorf("reading current chanspec %s: %w", key, err)
	}

	// "0" is the router's explicit auto-channel value; keep it auto. An empty
	// value means the key is absent/unreadable (NvramGetSingle returns "" for a
	// missing key) — that is not "auto", so fail rather than silently write
	// channel 0 and switch the radio to automatic channel selection.
	if cur == "0" {
		return 0, nil
	}

	if cur == "" {
		return 0, fmt.Errorf("cannot change bandwidth: %s is empty or absent, so the current channel is unknown; set channel explicitly", key)
	}

	lead := cur
	if i := strings.Index(cur, "/"); i >= 0 {
		lead = cur[:i]
	}

	ch, err := strconv.Atoi(lead)
	if err != nil {
		return 0, fmt.Errorf("cannot model current chanspec %s=%q to change bandwidth without dropping the channel; set channel explicitly", key, cur)
	}

	return ch, nil
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
func readOptionalInt64(target *types.Int64, result map[string]string, key string, transform func(string) (int, error)) error {
	v, ok := result[key]
	if !ok {
		return nil
	}

	if v == "" {
		if !target.IsNull() {
			*target = types.Int64Null()
		}

		return nil
	}

	n, err := transform(v)
	if err != nil {
		return err
	}

	*target = types.Int64Value(int64(n))

	return nil
}

// readOptionalInt64FromString reads a numeric string from NVRAM into an int64
// attribute, applying the same empty-clears-stale-state behavior as
// readOptionalInt64. A non-empty, non-numeric value is a malformed encoding
// (e.g. after a firmware or key-layout change) and returns an error rather than
// silently leaving the attribute at its prior/Unknown value.
func readOptionalInt64FromString(target *types.Int64, result map[string]string, key string) error {
	v, ok := result[key]
	if !ok {
		return nil
	}

	if v == "" {
		if !target.IsNull() {
			*target = types.Int64Null()
		}

		return nil
	}

	parsed, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return fmt.Errorf("NVRAM %s has a non-numeric value %q", key, v)
	}

	*target = types.Int64Value(parsed)

	return nil
}

// readOptionalBoolFromFlag reads a "0"/"1" NVRAM flag into a bool attribute,
// applying the same empty-clears-stale-state behavior as readOptionalInt64. A
// non-empty value other than "0" or "1" is a malformed encoding and returns an
// error rather than being silently coerced to false.
func readOptionalBoolFromFlag(target *types.Bool, result map[string]string, key string) error {
	v, ok := result[key]
	if !ok {
		return nil
	}

	if v == "" {
		if !target.IsNull() {
			*target = types.BoolNull()
		}

		return nil
	}

	if v != "0" && v != "1" {
		return fmt.Errorf("NVRAM %s has a non-boolean flag value %q (expected 0 or 1)", key, v)
	}

	*target = types.BoolValue(v == "1")

	return nil
}

// boolToFlag converts a bool to "0" or "1".
func boolToFlag(b bool) string {
	if b {
		return "1"
	}

	return "0"
}

// parseChannel extracts the channel number from a chanspec string. It handles
// the plain "36" and "36/80" forms, the 2.4 GHz 40 MHz sideband forms ("6u" /
// "6l"), and 6 GHz band-prefixed forms ("6g37/320-1"). "" and "0" mean automatic
// channel selection. A non-empty form whose channel cannot be parsed returns an
// error rather than silently reporting channel 0 (automatic), which would hide
// the router's real channel on import/refresh and produce false drift.
func parseChannel(chanspec string) (int, error) {
	if chanspec == "" || chanspec == "0" {
		return 0, nil
	}

	// Drop a "/<width>" suffix (e.g. "36/80", "6g37/320-1").
	lead := chanspec
	if i := strings.Index(lead, "/"); i >= 0 {
		lead = lead[:i]
	}

	// Drop a band prefix such as "2g"/"5g"/"6g": the channel follows the 'g'.
	if i := strings.LastIndexByte(lead, 'g'); i >= 0 {
		lead = lead[i+1:]
	}

	// Drop a trailing 2.4 GHz 40 MHz sideband marker ("u"/"l").
	lead = strings.TrimRight(lead, "ul")

	ch, err := strconv.Atoi(lead)
	if err != nil {
		return 0, fmt.Errorf("unparseable chanspec %q", chanspec)
	}

	return ch, nil
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
