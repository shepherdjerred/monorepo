package provider

import (
	"context"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/diag"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/shepherdjerred/monorepo/packages/terraform-provider-asuswrt/internal/client"
)

var (
	_ resource.Resource                = &systemResource{}
	_ resource.ResourceWithConfigure   = &systemResource{}
	_ resource.ResourceWithImportState = &systemResource{}
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
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.UseStateForUnknown(),
				},
			},
			"hostname": schema.StringAttribute{
				Description: "Router host name / Device Name (NVRAM: lan_hostname). Note: this is NOT computer_name, which is the Samba/NetBIOS name.",
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

	keys := []string{"lan_hostname", "time_zone", "ntp_server0", "ntp_server1"}

	result, err := r.client.NvramGet(ctx, keys)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read system settings", err.Error())

		return
	}

	readOptionalString(&state.Hostname, result, "lan_hostname")
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

// ImportState imports the singleton system resource. The import ID is ignored
// (always "system"); Read then populates all fields from the router.
func (r *systemResource) ImportState(ctx context.Context, _ resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("id"), "system")...)
}

// readOptionalString populates the target when the NVRAM key holds a non-empty
// value. It intentionally does NOT gate on the target being non-null (which
// would block import) but skips empty values so an unset NVRAM key leaves the
// attribute null rather than introducing a spurious "" != null diff.
func readOptionalString(target *types.String, result map[string]string, key string) {
	if v, ok := result[key]; ok && v != "" {
		*target = types.StringValue(v)
	}
}

// systemNvramMapping maps a model field to its NVRAM key and the rc_service that
// must run for the change to take effect (empty = no restart needed).
type systemNvramMapping struct {
	value    types.String
	nvramKey string
	service  string
}

// applySystem writes the system NVRAM values and triggers the union of the
// required service restarts (semicolon-joined, matching how the web UI issues
// multiple services in one apply).
func (r *systemResource) applySystem(ctx context.Context, plan *systemResourceModel) diag.Diagnostics {
	var diags diag.Diagnostics

	mappings := []systemNvramMapping{
		// lan_hostname is the router host name (the LAN page restarts net_and_phy).
		{value: plan.Hostname, nvramKey: "lan_hostname", service: client.ServiceNetAndPhy},
		{value: plan.Timezone, nvramKey: "time_zone", service: client.ServiceTime},
		{value: plan.NTPServer0, nvramKey: "ntp_server0", service: client.ServiceTime},
		{value: plan.NTPServer1, nvramKey: "ntp_server1", service: client.ServiceTime},
	}

	values := map[string]string{}

	var services []string

	seen := map[string]bool{}

	for _, m := range mappings {
		if m.value.IsNull() || m.value.IsUnknown() {
			continue
		}

		values[m.nvramKey] = m.value.ValueString()

		if m.service != "" && !seen[m.service] {
			seen[m.service] = true

			services = append(services, m.service)
		}
	}

	if len(values) == 0 {
		return diags
	}

	if err := r.client.NvramSet(ctx, values, strings.Join(services, ";")); err != nil {
		diags.AddError("Failed to apply system settings", err.Error())

		return diags
	}

	return diags
}
