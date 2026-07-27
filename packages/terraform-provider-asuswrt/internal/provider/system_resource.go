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
				Computed:    true,
			},
			"timezone": schema.StringAttribute{
				Description: "Timezone string (NVRAM: time_zone), e.g. EST5EDT,M3.2.0,M11.1.0.",
				Optional:    true,
				Computed:    true,
			},
			"ntp_server_0": schema.StringAttribute{
				Description: "Primary NTP server (NVRAM: ntp_server0).",
				Optional:    true,
				Computed:    true,
			},
			"ntp_server_1": schema.StringAttribute{
				Description: "Secondary NTP server (NVRAM: ntp_server1).",
				Optional:    true,
				Computed:    true,
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

	resp.Diagnostics.Append(r.applySystem(ctx, &plan, nil)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Optional+Computed attributes the config omitted are still Unknown after
	// applySystem (it only writes/tracks values the plan actually set).
	// Terraform requires every attribute to be known after apply, so read the
	// router back to resolve them to their real (or null) value.
	resp.Diagnostics.Append(r.readSystem(ctx, &plan)...)
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

	resp.Diagnostics.Append(r.readSystem(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *systemResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan systemResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	var priorState systemResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &priorState)...)
	if resp.Diagnostics.HasError() {
		return
	}

	plan.ID = types.StringValue("system")

	resp.Diagnostics.Append(r.applySystem(ctx, &plan, &priorState)...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(r.readSystem(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

// readSystem populates model from the router's current NVRAM values. Used by
// Read to refresh state, and by Create/Update to resolve Computed attributes
// the plan left Unknown into a known value (the router's actual value, or
// null when the router has none).
func (r *systemResource) readSystem(ctx context.Context, model *systemResourceModel) diag.Diagnostics {
	var diags diag.Diagnostics

	keys := []string{"lan_hostname", "time_zone", "ntp_server0", "ntp_server1"}

	result, err := r.client.NvramGet(ctx, keys)
	if err != nil {
		diags.AddError("Failed to read system settings", err.Error())

		return diags
	}

	readOptionalString(&model.Hostname, result, "lan_hostname")
	readOptionalString(&model.Timezone, result, "time_zone")
	readOptionalString(&model.NTPServer0, result, "ntp_server0")
	readOptionalString(&model.NTPServer1, result, "ntp_server1")

	return diags
}

func (r *systemResource) Delete(_ context.Context, _ resource.DeleteRequest, _ *resource.DeleteResponse) {
	// System settings cannot be truly deleted; this is a no-op.
}

// ImportState imports the singleton system resource. The import ID is ignored
// (always "system"); Read then populates all fields from the router.
func (r *systemResource) ImportState(ctx context.Context, _ resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("id"), "system")...)
}

// readOptionalString populates the target from the NVRAM key's current value.
// It intentionally does NOT gate on the target being non-null (which would
// block import) or known (which would leave a Computed attribute Unknown
// after apply): a non-empty value sets the target, and an empty value clears
// it to null unless the target is already null — otherwise a value the
// router cleared (e.g. the user unset it out-of-band) would be left stale in
// state instead of reporting the drift.
func readOptionalString(target *types.String, result map[string]string, key string) {
	v, ok := result[key]
	if !ok {
		return
	}

	if v != "" {
		*target = types.StringValue(v)
	} else if !target.IsNull() {
		*target = types.StringNull()
	}
}

// systemNvramMapping maps a model field to its NVRAM key and the rc_service that
// must run for the change to take effect (empty = no restart needed). prior is
// the same field's previous state value, used to skip restarting a service for
// a field that is merely present in the plan, not actually changing.
type systemNvramMapping struct {
	value    types.String
	prior    types.String
	nvramKey string
	service  string
}

// buildSystemMappings pairs each system field's planned value with its prior
// state value (for Update change-detection; zero-valued when prior is nil) and
// its NVRAM key/restart service.
func buildSystemMappings(plan, prior *systemResourceModel) []systemNvramMapping {
	var priorHostname, priorTimezone, priorNTPServer0, priorNTPServer1 types.String
	if prior != nil {
		priorHostname, priorTimezone = prior.Hostname, prior.Timezone
		priorNTPServer0, priorNTPServer1 = prior.NTPServer0, prior.NTPServer1
	}

	return []systemNvramMapping{
		// lan_hostname is the router host name (the LAN page restarts net_and_phy).
		{value: plan.Hostname, prior: priorHostname, nvramKey: "lan_hostname", service: client.ServiceNetAndPhy},
		{value: plan.Timezone, prior: priorTimezone, nvramKey: "time_zone", service: client.ServiceTime},
		{value: plan.NTPServer0, prior: priorNTPServer0, nvramKey: "ntp_server0", service: client.ServiceTime},
		{value: plan.NTPServer1, prior: priorNTPServer1, nvramKey: "ntp_server1", service: client.ServiceTime},
	}
}

// collectSystemChanges walks the mappings, returning the NVRAM values to
// write and the deduplicated services to restart. hasPrior distinguishes
// Create (every present field is new, so always restart-worthy) from Update
// (only a field whose value actually changed should trigger its restart —
// otherwise, e.g., a timezone-only update would needlessly restart
// net_and_phy for an unchanged hostname).
func collectSystemChanges(mappings []systemNvramMapping, hasPrior bool) (values map[string]string, services []string) {
	values = map[string]string{}
	seen := map[string]bool{}

	for _, m := range mappings {
		if m.value.IsNull() || m.value.IsUnknown() {
			continue
		}

		values[m.nvramKey] = m.value.ValueString()

		changed := !hasPrior || !m.value.Equal(m.prior)
		if !changed || m.service == "" || seen[m.service] {
			continue
		}

		seen[m.service] = true

		services = append(services, m.service)
	}

	return values, services
}

// applySystem writes the system NVRAM values and triggers the union of the
// required service restarts (semicolon-joined, matching how the web UI issues
// multiple services in one apply). prior is the pre-Update state (nil on
// Create).
func (r *systemResource) applySystem(ctx context.Context, plan, prior *systemResourceModel) diag.Diagnostics {
	var diags diag.Diagnostics

	values, services := collectSystemChanges(buildSystemMappings(plan, prior), prior != nil)
	if len(values) == 0 {
		return diags
	}

	if err := r.client.NvramSet(ctx, values, strings.Join(services, ";")); err != nil {
		diags.AddError("Failed to apply system settings", err.Error())
	}

	return diags
}
