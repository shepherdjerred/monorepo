package provider

import (
	"context"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/shepherdjerred/monorepo/packages/terraform-provider-asuswrt/internal/client"
)

var (
	_ resource.Resource                = &portForwardResource{}
	_ resource.ResourceWithConfigure   = &portForwardResource{}
	_ resource.ResourceWithImportState = &portForwardResource{}
)

type portForwardResource struct {
	client *client.Client
}

type portForwardResourceModel struct {
	Name         types.String `tfsdk:"name"`
	Protocol     types.String `tfsdk:"protocol"`
	ExternalPort types.String `tfsdk:"external_port"`
	InternalIP   types.String `tfsdk:"internal_ip"`
	InternalPort types.String `tfsdk:"internal_port"`
	SourceIP     types.String `tfsdk:"source_ip"`
}

// NewPortForwardResource returns a new port forward resource.
func NewPortForwardResource() resource.Resource {
	return &portForwardResource{}
}

func (r *portForwardResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_port_forward"
}

func (r *portForwardResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages a port forwarding rule on the router.",
		Attributes: map[string]schema.Attribute{
			"name": schema.StringAttribute{
				Description: "Rule name (used as unique identifier).",
				Required:    true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
				Validators: packedFieldValidators(),
			},
			"protocol": schema.StringAttribute{
				Description: "Protocol: tcp, udp, or both.",
				Required:    true,
				Validators:  packedFieldValidators(),
			},
			"external_port": schema.StringAttribute{
				Description: "External port or range (e.g., 80 or 8080:8090).",
				Required:    true,
				Validators:  packedFieldValidators(),
			},
			"internal_ip": schema.StringAttribute{
				Description: "Internal destination IP address.",
				Required:    true,
				Validators:  packedFieldValidators(),
			},
			"internal_port": schema.StringAttribute{
				Description: "Internal destination port.",
				Required:    true,
				Validators:  packedFieldValidators(),
			},
			"source_ip": schema.StringAttribute{
				Description: "Restrict to source IP, MAC, or IP range. Empty means any.",
				Optional:    true,
				Validators:  packedFieldValidators(),
			},
		},
	}
}

func (r *portForwardResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

func (r *portForwardResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan portForwardResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Serialize the whole read-modify-write against vts_rulelist so a concurrent
	// apply on another rule can't read the same list and clobber this edit when
	// it writes back.
	unlockList := r.client.LockList("vts_rulelist")
	defer unlockList()

	entries, err := r.readRules(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read port forward rules", err.Error())

		return
	}

	entries = append(entries, r.planToEntry(&plan))

	if err := r.writeRules(ctx, entries); err != nil {
		resp.Diagnostics.AddError("Failed to write port forward rules", err.Error())

		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *portForwardResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state portForwardResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	entries, err := r.readRules(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read port forward rules", err.Error())

		return
	}

	name := state.Name.ValueString()
	entry := findRuleByName(entries, name)

	if entry == nil {
		resp.State.RemoveResource(ctx)

		return
	}

	// findRuleByName matches case-insensitively, so an import of "http" binds to
	// a live rule named "HTTP" — the two name the same rule. Keep the spelling
	// already in state rather than adopting the router's: `name` is the identity
	// and RequiresReplace, so rewriting it to a casing the configuration does
	// not use makes every subsequent plan propose destroying and recreating a
	// rule that differs only in case. Casing is not semantic here, so it must
	// not be allowed to produce a diff.

	state.Protocol = types.StringValue(entry.Protocol)
	state.ExternalPort = types.StringValue(entry.ExternalPort)
	state.InternalIP = types.StringValue(entry.InternalIP)
	state.InternalPort = types.StringValue(entry.InternalPort)

	if entry.SourceIP != "" {
		state.SourceIP = types.StringValue(entry.SourceIP)
	} else if !state.SourceIP.IsNull() {
		state.SourceIP = types.StringNull()
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *portForwardResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan portForwardResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Serialize the whole read-modify-write against vts_rulelist so a concurrent
	// apply on another rule can't read the same list and clobber this edit when
	// it writes back.
	unlockList := r.client.LockList("vts_rulelist")
	defer unlockList()

	entries, err := r.readRules(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read port forward rules", err.Error())

		return
	}

	name := plan.Name.ValueString()

	for i := range entries {
		if strings.EqualFold(entries[i].Name, name) {
			// Overwrite in place rather than replacing the parsed entry, so
			// the router's trailing fields on this rule survive the rewrite.
			applyPlanToEntry(&entries[i], &plan)

			break
		}
	}

	if err := r.writeRules(ctx, entries); err != nil {
		resp.Diagnostics.AddError("Failed to write port forward rules", err.Error())

		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *portForwardResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state portForwardResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Serialize the whole read-modify-write against vts_rulelist so a concurrent
	// apply on another rule can't read the same list and clobber this edit when
	// it writes back.
	unlockList := r.client.LockList("vts_rulelist")
	defer unlockList()

	entries, err := r.readRules(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read port forward rules", err.Error())

		return
	}

	name := state.Name.ValueString()
	filtered := make([]client.PortForwardEntry, 0, len(entries))

	for i := range entries {
		if !strings.EqualFold(entries[i].Name, name) {
			filtered = append(filtered, entries[i])
		}
	}

	if err := r.writeRules(ctx, filtered); err != nil {
		resp.Diagnostics.AddError("Failed to write port forward rules", err.Error())
	}
}

func (r *portForwardResource) readRules(ctx context.Context) ([]client.PortForwardEntry, error) {
	val, err := r.client.NvramGetSingle(ctx, "vts_rulelist")
	if err != nil {
		return nil, fmt.Errorf("reading vts_rulelist: %w", err)
	}

	entries, err := client.ParseVTSRuleList(val)
	if err != nil {
		return nil, fmt.Errorf("reading vts_rulelist: %w", err)
	}

	return entries, nil
}

func (r *portForwardResource) writeRules(ctx context.Context, entries []client.PortForwardEntry) error {
	vtsEnable := "0"
	if len(entries) > 0 {
		vtsEnable = "1"
	}

	values := map[string]string{
		"vts_rulelist": client.EncodeVTSRuleListForWrite(entries),
		"vts_enable_x": vtsEnable,
	}

	if err := r.client.NvramSet(ctx, values, client.ServiceFirewall); err != nil {
		return fmt.Errorf("writing vts_rulelist: %w", err)
	}

	return nil
}

// applyPlanToEntry overwrites exactly the fields this provider models, leaving
// everything else on the entry untouched.
//
// Update must not replace a parsed entry wholesale: the router's own trailing
// fields live in Extra/HasExtra, the plan knows nothing about them, and the
// whole list is re-serialized on every write. Overwriting in place keeps those
// fields, and keeps doing so if the client ever preserves more of them.
func applyPlanToEntry(entry *client.PortForwardEntry, plan *portForwardResourceModel) {
	entry.Name = plan.Name.ValueString()
	entry.ExternalPort = plan.ExternalPort.ValueString()
	entry.InternalIP = plan.InternalIP.ValueString()
	entry.InternalPort = plan.InternalPort.ValueString()
	entry.Protocol = plan.Protocol.ValueString()

	// Assigned unconditionally so clearing source_ip in config clears it on the
	// router rather than leaving the previous restriction in place.
	entry.SourceIP = ""
	if !plan.SourceIP.IsNull() {
		entry.SourceIP = plan.SourceIP.ValueString()
	}
}

func (r *portForwardResource) planToEntry(plan *portForwardResourceModel) client.PortForwardEntry {
	var entry client.PortForwardEntry

	applyPlanToEntry(&entry, plan)

	return entry
}

// ImportState imports a port forward rule by its name. Read then populates the
// remaining attributes from the router.
func (r *portForwardResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	// Trim as the DHCP lease and wireless importers do. Read finds the rule
	// with strings.EqualFold, which tolerates case but not padding, so an ID
	// like "Plex " would match nothing and drop the resource from state.
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("name"), strings.TrimSpace(req.ID))...)
}

// findRuleByName searches for a port forward rule by name (case-insensitive).
func findRuleByName(entries []client.PortForwardEntry, name string) *client.PortForwardEntry {
	for i := range entries {
		if strings.EqualFold(entries[i].Name, name) {
			return &entries[i]
		}
	}

	return nil
}
