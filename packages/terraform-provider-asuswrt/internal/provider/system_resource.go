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

	var config systemResourceModel

	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	plan.ID = types.StringValue("system")

	resp.Diagnostics.Append(r.applySystem(ctx, &plan, &config, false)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Optional+Computed attributes the config omitted are still Unknown after
	// applySystem (it only writes values the config set or that actually
	// changed). Terraform requires every attribute to be known after apply, so
	// read the router back to resolve them to their real (or null) value.
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

	var config systemResourceModel

	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	plan.ID = types.StringValue("system")

	resp.Diagnostics.Append(r.applySystem(ctx, &plan, &config, true)...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(r.readSystem(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

// systemNvramKeys are the NVRAM keys backing this resource, in model order.
var systemNvramKeys = []string{"lan_hostname", "time_zone", "ntp_server0", "ntp_server1"}

// readSystem populates model from the router's current NVRAM values. Used by
// Read to refresh state, and by Create/Update to resolve Computed attributes
// the plan left Unknown into a known value (the router's actual value, or
// null when the router has none).
func (r *systemResource) readSystem(ctx context.Context, model *systemResourceModel) diag.Diagnostics {
	var diags diag.Diagnostics

	result, err := r.client.NvramGet(ctx, systemNvramKeys)
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

// resolveOptionalRead maps a router value onto prior state for an
// Optional+Computed string.
//
// A non-empty router value always wins. An empty one normally becomes null so
// plans stay clean, with one exception: prior state holding a *known* empty
// string means the operator configured "" explicitly, and nulling that both
// risks the framework rejecting the apply as an inconsistent result and makes
// every later plan diff "" against null forever.
//
// An Unknown prior is never preserved — that is a Computed attribute the plan
// left unresolved, and returning it would leave it Unknown after apply. A
// previously non-empty value the router no longer reports still becomes null,
// so genuine external clearing is still reported as drift.
func resolveOptionalRead(prior types.String, routerValue string) types.String {
	if routerValue != "" {
		return types.StringValue(routerValue)
	}

	if !prior.IsNull() && !prior.IsUnknown() && prior.ValueString() == "" {
		return prior
	}

	return types.StringNull()
}

// readOptionalString populates the target from the NVRAM key's current value.
// It intentionally does NOT gate on the target being non-null (which would
// block import) or known (which would leave a Computed attribute Unknown
// after apply).
func readOptionalString(target *types.String, result map[string]string, key string) {
	v, ok := result[key]
	if !ok {
		return
	}

	*target = resolveOptionalRead(*target, v)
}

// systemNvramMapping maps a model field to its NVRAM key and the rc_service that
// must run for the change to take effect (empty = no restart needed). configured
// records whether the operator set the field in configuration at all, which the
// planned value alone cannot express: an omitted Optional+Computed attribute is
// filled from prior state during planning and so looks identical to one the
// operator pinned to that same value.
type systemNvramMapping struct {
	value      types.String
	configured bool
	nvramKey   string
	service    string
}

// buildSystemMappings pairs each system field's planned value with the config
// value the operator supplied (to tell "omitted" from "set") and its NVRAM
// key/restart service.
func buildSystemMappings(plan, config *systemResourceModel) []systemNvramMapping {
	return []systemNvramMapping{
		// lan_hostname is the router host name (the LAN page restarts net_and_phy).
		{
			value:      plan.Hostname,
			configured: !config.Hostname.IsNull(),
			nvramKey:   "lan_hostname",
			service:    client.ServiceNetAndPhy,
		},
		{
			value:      plan.Timezone,
			configured: !config.Timezone.IsNull(),
			nvramKey:   "time_zone",
			service:    client.ServiceTime,
		},
		{
			value:      plan.NTPServer0,
			configured: !config.NTPServer0.IsNull(),
			nvramKey:   "ntp_server0",
			service:    client.ServiceTime,
		},
		{
			value:      plan.NTPServer1,
			configured: !config.NTPServer1.IsNull(),
			nvramKey:   "ntp_server1",
			service:    client.ServiceTime,
		},
	}
}

// collectSystemChanges walks the mappings, returning the NVRAM values to
// write and the deduplicated services to restart. live holds the router's
// current values for the same NVRAM keys and is consulted on Update only.
//
// On Create every known field is new, so all of them are written. On Update a
// field is written only when the operator configured it *and* its planned value
// differs from what the router currently holds.
//
// Both halves of that condition matter, and the comparison is deliberately
// against the router rather than prior state. An unconfigured Optional+Computed
// field is populated from the router by refresh and carried into the plan, so
// writing every known planned value would push that snapshot back: with a saved
// plan or -refresh=false the snapshot is stale, and changing one managed setting
// would silently revert a newer out-of-band hostname/timezone/NTP value. But a
// *configured* value is never stale — it comes from the operator's
// configuration — so it cannot be skipped merely because it matches prior state.
// Under a saved plan or -refresh=false that prior state may itself be stale
// while the router has drifted, and skipping the write would leave the drift in
// place for the post-apply readSystem to pull into the configured attribute,
// which Terraform then rejects as an inconsistent result. Comparing against the
// live value reasserts exactly the configured fields the router disagrees with,
// and still writes nothing (so restarts nothing) when the router already agrees
// — no bouncing net_and_phy on a timezone-only update.
//
// Because the write set and the restart set are the same set, every value this
// writes also gets its rc_service, so a write can never land without the restart
// that makes it take effect. A key absent from live cannot be compared, so it is
// written: enforcing the operator's configuration is the safe direction.
func collectSystemChanges(
	mappings []systemNvramMapping,
	live map[string]string,
	isUpdate bool,
) (values map[string]string, services []string) {
	values = map[string]string{}
	seen := map[string]bool{}

	for i := range mappings {
		m := &mappings[i]

		if m.value.IsNull() || m.value.IsUnknown() {
			continue
		}

		if isUpdate && skipSystemFieldOnUpdate(m, live) {
			continue
		}

		values[m.nvramKey] = m.value.ValueString()

		if m.service == "" || seen[m.service] {
			continue
		}

		seen[m.service] = true

		services = append(services, m.service)
	}

	return values, services
}

// skipSystemFieldOnUpdate reports whether an Update should leave this field
// alone: either the operator never configured it (so the planned value is just
// a refresh snapshot that must not be pushed back), or the router already holds
// the configured value and there is nothing to enforce or restart. A key the
// router did not report is not skipped — it cannot be compared, and enforcing
// the configuration is the safe direction.
func skipSystemFieldOnUpdate(m *systemNvramMapping, live map[string]string) bool {
	if !m.configured {
		return true
	}

	current, ok := live[m.nvramKey]

	return ok && current == m.value.ValueString()
}

// applySystem writes the system NVRAM values and triggers the union of the
// required service restarts (semicolon-joined, matching how the web UI issues
// multiple services in one apply). config is the operator's configuration;
// isUpdate distinguishes Update (where only configured fields the router
// disagrees with are written) from Create (where every known field is).
func (r *systemResource) applySystem(
	ctx context.Context,
	plan, config *systemResourceModel,
	isUpdate bool,
) diag.Diagnostics {
	var diags diag.Diagnostics

	// Update decides what to write from the router's live values, so a
	// configured field that drifted out of band is reasserted even when the
	// plan matches (possibly stale) prior state.
	var live map[string]string

	if isUpdate {
		var err error

		live, err = r.client.NvramGet(ctx, systemNvramKeys)
		if err != nil {
			diags.AddError("Failed to read system settings", err.Error())

			return diags
		}
	}

	values, services := collectSystemChanges(buildSystemMappings(plan, config), live, isUpdate)
	if len(values) == 0 {
		return diags
	}

	if err := r.client.NvramSet(ctx, values, strings.Join(services, ";")); err != nil {
		diags.AddError("Failed to apply system settings", err.Error())
	}

	return diags
}
