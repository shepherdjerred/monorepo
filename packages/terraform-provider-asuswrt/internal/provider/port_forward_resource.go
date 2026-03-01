package provider

import (
	"context"
	"fmt"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/shepherdjerred/terraform-provider-asuswrt/internal/client"
)

var (
	_ resource.Resource              = &portForwardResource{}
	_ resource.ResourceWithConfigure = &portForwardResource{}
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
			},
			"protocol": schema.StringAttribute{
				Description: "Protocol: tcp, udp, or both.",
				Required:    true,
			},
			"external_port": schema.StringAttribute{
				Description: "External port or range (e.g., 80 or 8080:8090).",
				Required:    true,
			},
			"internal_ip": schema.StringAttribute{
				Description: "Internal destination IP address.",
				Required:    true,
			},
			"internal_port": schema.StringAttribute{
				Description: "Internal destination port.",
				Required:    true,
			},
			"source_ip": schema.StringAttribute{
				Description: "Restrict to source IP, MAC, or IP range. Empty means any.",
				Optional:    true,
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

	entries, err := r.readRules(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read port forward rules", err.Error())

		return
	}

	name := plan.Name.ValueString()
	newEntry := r.planToEntry(&plan)

	for i, e := range entries {
		if strings.EqualFold(e.Name, name) {
			entries[i] = newEntry

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

	entries, err := r.readRules(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read port forward rules", err.Error())

		return
	}

	name := state.Name.ValueString()
	filtered := make([]client.PortForwardEntry, 0, len(entries))

	for _, e := range entries {
		if !strings.EqualFold(e.Name, name) {
			filtered = append(filtered, e)
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

	return client.ParseVTSRuleList(val), nil
}

func (r *portForwardResource) writeRules(ctx context.Context, entries []client.PortForwardEntry) error {
	vtsEnable := "0"
	if len(entries) > 0 {
		vtsEnable = "1"
	}

	values := map[string]string{
		"vts_rulelist": client.SerializeVTSRuleList(entries),
		"vts_enable_x": vtsEnable,
	}

	if err := r.client.NvramSet(ctx, values, client.ServiceFirewall); err != nil {
		return fmt.Errorf("writing vts_rulelist: %w", err)
	}

	return nil
}

func (r *portForwardResource) planToEntry(plan *portForwardResourceModel) client.PortForwardEntry {
	entry := client.PortForwardEntry{
		Name:         plan.Name.ValueString(),
		ExternalPort: plan.ExternalPort.ValueString(),
		InternalIP:   plan.InternalIP.ValueString(),
		InternalPort: plan.InternalPort.ValueString(),
		Protocol:     plan.Protocol.ValueString(),
	}

	if !plan.SourceIP.IsNull() {
		entry.SourceIP = plan.SourceIP.ValueString()
	}

	return entry
}

// findRuleByName searches for a port forward rule by name (case-insensitive).
func findRuleByName(entries []client.PortForwardEntry, name string) *client.PortForwardEntry {
	for i, e := range entries {
		if strings.EqualFold(e.Name, name) {
			return &entries[i]
		}
	}

	return nil
}
