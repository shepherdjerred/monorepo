package provider

import (
	"context"
	"fmt"
	"strconv"
	"strings"

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
			},
			"wpa_passphrase": schema.StringAttribute{
				Description: "WPA pre-shared key. Write-only: never read back from the router, so it is not populated on import. Omit it from tracked config to keep plans clean.",
				Optional:    true,
				Sensitive:   true,
			},
			"channel": schema.Int64Attribute{
				Description: "Channel number. 0 = auto.",
				Optional:    true,
			},
			"bandwidth": schema.Int64Attribute{
				Description: "Channel bandwidth: 0=auto, 1=20MHz, 2=40MHz, 4=80MHz, 5=160MHz.",
				Optional:    true,
			},
			"hidden": schema.BoolAttribute{
				Description: "Hide SSID from broadcast.",
				Optional:    true,
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

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *wirelessNetworkResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state wirelessNetworkResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	band := int(state.Band.ValueInt64())
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
		resp.Diagnostics.AddError("Failed to read wireless settings", err.Error())

		return
	}

	state.SSID = types.StringValue(result[prefix+"ssid"])
	state.AuthMode = types.StringValue(result[prefix+"auth_mode_x"])

	readOptionalString(&state.Crypto, result, prefix+"crypto")
	readOptionalInt64(&state.Channel, result, prefix+"chanspec", parseChannel)
	readOptionalInt64FromString(&state.Bandwidth, result, prefix+"bw")
	readOptionalBoolFromFlag(&state.Hidden, result, prefix+"closed")

	// WPA passphrase is write-only; we don't read it back to avoid state drift.

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

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
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

	if !plan.Channel.IsNull() && !plan.Channel.IsUnknown() {
		values[prefix+"chanspec"] = formatChanspec(int(plan.Channel.ValueInt64()), int(plan.Bandwidth.ValueInt64()))
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

// setOptionalString adds a string attribute to the values map if it is set.
func setOptionalString(values map[string]string, key string, attr types.String) {
	if !attr.IsNull() && !attr.IsUnknown() {
		values[key] = attr.ValueString()
	}
}

// readOptionalInt64 reads an NVRAM value and applies a transform to get an int64.
// Populates from a non-empty value regardless of whether the target is null (so
// imported state reflects the router); empty NVRAM values are left as null.
func readOptionalInt64(target *types.Int64, result map[string]string, key string, transform func(string) int) {
	if v, ok := result[key]; ok && v != "" {
		*target = types.Int64Value(int64(transform(v)))
	}
}

// readOptionalInt64FromString reads a numeric string from NVRAM into an int64 attribute.
func readOptionalInt64FromString(target *types.Int64, result map[string]string, key string) {
	if v, ok := result[key]; ok && v != "" {
		if parsed, err := strconv.ParseInt(v, 10, 64); err == nil {
			*target = types.Int64Value(parsed)
		}
	}
}

// readOptionalBoolFromFlag reads a "0"/"1" NVRAM flag into a bool attribute.
// Skips empty values so an unset flag leaves the attribute null.
func readOptionalBoolFromFlag(target *types.Bool, result map[string]string, key string) {
	if v, ok := result[key]; ok && v != "" {
		*target = types.BoolValue(v == "1")
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

// formatChanspec creates a chanspec string from channel and bandwidth.
func formatChanspec(channel, bandwidth int) string {
	if channel == 0 {
		return "0"
	}

	bwStr := bandwidthToString(bandwidth)
	if bwStr == "" {
		return strconv.Itoa(channel)
	}

	return strconv.Itoa(channel) + "/" + bwStr
}

// bandwidthToString converts the bandwidth int to the chanspec suffix.
func bandwidthToString(bw int) string {
	switch bw {
	case 1:
		return "20"
	case 2:
		return "40"
	case 4:
		return "80"
	case 5:
		return "160"
	default:
		return ""
	}
}
