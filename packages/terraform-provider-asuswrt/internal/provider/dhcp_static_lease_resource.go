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
	_ resource.Resource                = &dhcpStaticLeaseResource{}
	_ resource.ResourceWithConfigure   = &dhcpStaticLeaseResource{}
	_ resource.ResourceWithImportState = &dhcpStaticLeaseResource{}
)

type dhcpStaticLeaseResource struct {
	client *client.Client
}

type dhcpStaticLeaseResourceModel struct {
	MAC      types.String `tfsdk:"mac"`
	IP       types.String `tfsdk:"ip"`
	Hostname types.String `tfsdk:"hostname"`
}

// NewDHCPStaticLeaseResource returns a new DHCP static lease resource.
func NewDHCPStaticLeaseResource() resource.Resource {
	return &dhcpStaticLeaseResource{}
}

func (r *dhcpStaticLeaseResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_dhcp_static_lease"
}

func (r *dhcpStaticLeaseResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages a single DHCP static lease on the router.",
		Attributes: map[string]schema.Attribute{
			"mac": schema.StringAttribute{
				Description: "MAC address (e.g., AA:BB:CC:DD:EE:FF). Used as the unique identifier.",
				Required:    true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
			},
			"ip": schema.StringAttribute{
				Description: "Static IP address to assign.",
				Required:    true,
			},
			"hostname": schema.StringAttribute{
				Description: "Optional hostname for the lease.",
				Optional:    true,
				Computed:    true,
			},
		},
	}
}

func (r *dhcpStaticLeaseResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

func (r *dhcpStaticLeaseResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan dhcpStaticLeaseResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	mac := strings.ToUpper(plan.MAC.ValueString())

	entries, err := r.readLeases(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read DHCP leases", err.Error())

		return
	}

	entry := client.DHCPStaticEntry{MAC: mac, IP: plan.IP.ValueString()}
	if !plan.Hostname.IsNull() {
		entry.Hostname = plan.Hostname.ValueString()
	}

	entries = append(entries, entry)

	if err := r.writeLeases(ctx, entries); err != nil {
		resp.Diagnostics.AddError("Failed to write DHCP leases", err.Error())

		return
	}

	plan.MAC = types.StringValue(mac)

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *dhcpStaticLeaseResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state dhcpStaticLeaseResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	mac := strings.ToUpper(state.MAC.ValueString())

	entries, err := r.readLeases(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read DHCP leases", err.Error())

		return
	}

	var found *client.DHCPStaticEntry

	for i := range entries {
		if strings.EqualFold(entries[i].MAC, mac) {
			found = &entries[i]

			break
		}
	}

	if found == nil {
		resp.State.RemoveResource(ctx)

		return
	}

	state.IP = types.StringValue(found.IP)

	// Hostname lives in dhcp_staticlist field 4 (there is no dhcp_hostnames key
	// on this firmware). Empty hostname maps to null to keep plans clean.
	if found.Hostname != "" {
		state.Hostname = types.StringValue(found.Hostname)
	} else if !state.Hostname.IsNull() {
		state.Hostname = types.StringNull()
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *dhcpStaticLeaseResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan dhcpStaticLeaseResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	mac := strings.ToUpper(plan.MAC.ValueString())

	entries, err := r.readLeases(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read DHCP leases", err.Error())

		return
	}

	hostname := ""
	if !plan.Hostname.IsNull() {
		hostname = plan.Hostname.ValueString()
	}

	for i := range entries {
		if strings.EqualFold(entries[i].MAC, mac) {
			// Preserve field 3 (DNS); update IP and hostname.
			entries[i].IP = plan.IP.ValueString()
			entries[i].Hostname = hostname

			break
		}
	}

	if err := r.writeLeases(ctx, entries); err != nil {
		resp.Diagnostics.AddError("Failed to write DHCP leases", err.Error())

		return
	}

	plan.MAC = types.StringValue(mac)

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *dhcpStaticLeaseResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state dhcpStaticLeaseResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	mac := strings.ToUpper(state.MAC.ValueString())

	entries, err := r.readLeases(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read DHCP leases", err.Error())

		return
	}

	filtered := make([]client.DHCPStaticEntry, 0, len(entries))

	for _, e := range entries {
		if !strings.EqualFold(e.MAC, mac) {
			filtered = append(filtered, e)
		}
	}

	if err := r.writeLeases(ctx, filtered); err != nil {
		resp.Diagnostics.AddError("Failed to write DHCP leases", err.Error())
	}
}

// ImportState imports a DHCP static lease by its MAC address. The MAC is
// normalized to uppercase to match the resource's canonical form; Read then
// populates the IP and hostname from the router.
func (r *dhcpStaticLeaseResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	resp.Diagnostics.Append(resp.State.SetAttribute(ctx, path.Root("mac"), strings.ToUpper(strings.TrimSpace(req.ID)))...)
}

func (r *dhcpStaticLeaseResource) readLeases(ctx context.Context) ([]client.DHCPStaticEntry, error) {
	val, err := r.client.NvramGetSingle(ctx, "dhcp_staticlist")
	if err != nil {
		return nil, fmt.Errorf("reading dhcp_staticlist: %w", err)
	}

	return client.ParseDHCPStaticList(val), nil
}

func (r *dhcpStaticLeaseResource) writeLeases(ctx context.Context, entries []client.DHCPStaticEntry) error {
	values := map[string]string{
		"dhcp_staticlist": client.SerializeDHCPStaticList(entries),
	}

	if err := r.client.NvramSet(ctx, values, client.ServiceDNSMasq); err != nil {
		return fmt.Errorf("writing dhcp_staticlist: %w", err)
	}

	return nil
}
