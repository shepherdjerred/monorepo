package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/shepherdjerred/terraform-provider-asuswrt/internal/client"
)

var (
	_ resource.Resource              = &systemResource{}
	_ resource.ResourceWithConfigure = &systemResource{}
)

type systemResource struct {
	client *client.Client
}

type systemResourceModel struct {
	ID         types.String `tfsdk:"id"`
	Hostname   types.String `tfsdk:"hostname"`
	Timezone   types.String `tfsdk:"timezone"`
	NTPServer0 types.String `tfsdk:"ntp_server_0"`
	NTPServer1 types.String `tfsdk:"ntp_server_1"`
}

// NewSystemResource returns a new system resource.
func NewSystemResource() resource.Resource {
	return &systemResource{}
}

func (r *systemResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_system"
}

func (r *systemResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages system-level settings on the router (hostname, timezone, NTP).",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				Description: "Resource identifier (always 'system').",
				Computed:    true,
			},
			"hostname": schema.StringAttribute{
				Description: "Router hostname (NVRAM: computer_name).",
				Optional:    true,
			},
			"timezone": schema.StringAttribute{
				Description: "Timezone string (NVRAM: time_zone), e.g. EST5EDT,M3.2.0,M11.1.0.",
				Optional:    true,
			},
			"ntp_server_0": schema.StringAttribute{
				Description: "Primary NTP server (NVRAM: ntp_server0).",
				Optional:    true,
			},
			"ntp_server_1": schema.StringAttribute{
				Description: "Secondary NTP server (NVRAM: ntp_server1).",
				Optional:    true,
			},
		},
	}
}

func (r *systemResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

func (r *systemResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan systemResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	plan.ID = types.StringValue("system")

	resp.Diagnostics.Append(r.applySystem(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *systemResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state systemResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	keys := []string{"computer_name", "time_zone", "ntp_server0", "ntp_server1"}

	result, err := r.client.NvramGet(ctx, keys)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read system settings", err.Error())

		return
	}

	readOptionalString(&state.Hostname, result, "computer_name")
	readOptionalString(&state.Timezone, result, "time_zone")
	readOptionalString(&state.NTPServer0, result, "ntp_server0")
	readOptionalString(&state.NTPServer1, result, "ntp_server1")

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *systemResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan systemResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	plan.ID = types.StringValue("system")

	resp.Diagnostics.Append(r.applySystem(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *systemResource) Delete(_ context.Context, _ resource.DeleteRequest, _ *resource.DeleteResponse) {
	// System settings cannot be truly deleted; this is a no-op.
}

// readOptionalString updates the target only if the NVRAM key is present and the attribute is managed.
func readOptionalString(target *types.String, result map[string]string, key string) {
	if v, ok := result[key]; ok && !target.IsNull() {
		*target = types.StringValue(v)
	}
}

// systemNvramMapping maps model fields to NVRAM keys and whether they trigger a time restart.
type systemNvramMapping struct {
	value       types.String
	nvramKey    string
	timeRestart bool
}

// applySystem writes the system NVRAM values and triggers appropriate service restarts.
func (r *systemResource) applySystem(ctx context.Context, plan *systemResourceModel) diag.Diagnostics {
	var diags diag.Diagnostics

	mappings := []systemNvramMapping{
		{value: plan.Hostname, nvramKey: "computer_name", timeRestart: false},
		{value: plan.Timezone, nvramKey: "time_zone", timeRestart: true},
		{value: plan.NTPServer0, nvramKey: "ntp_server0", timeRestart: true},
		{value: plan.NTPServer1, nvramKey: "ntp_server1", timeRestart: true},
	}

	values := map[string]string{}
	needTimeRestart := false

	for _, m := range mappings {
		if !m.value.IsNull() && !m.value.IsUnknown() {
			values[m.nvramKey] = m.value.ValueString()

			if m.timeRestart {
				needTimeRestart = true
			}
		}
	}

	if len(values) == 0 {
		return diags
	}

	rcService := ""
	if needTimeRestart {
		rcService = client.ServiceTime
	}

	if err := r.client.NvramSet(ctx, values, rcService); err != nil {
		diags.AddError("Failed to apply system settings", err.Error())

		return diags
	}

	return diags
}
