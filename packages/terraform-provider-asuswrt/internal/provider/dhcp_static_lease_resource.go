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
	_ resource.Resource              = &dhcpStaticLeaseResource{}
	_ resource.ResourceWithConfigure = &dhcpStaticLeaseResource{}
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

	entries, hostnames, err := r.readLeases(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read DHCP leases", err.Error())

		return
	}

	entries = append(entries, client.DHCPStaticEntry{
		MAC: mac,
		IP:  plan.IP.ValueString(),
	})

	if !plan.Hostname.IsNull() && plan.Hostname.ValueString() != "" {
		hostnames[mac] = plan.Hostname.ValueString()
	}

	if err := r.writeLeases(ctx, entries, hostnames); err != nil {
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

	entries, hostnames, err := r.readLeases(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read DHCP leases", err.Error())

		return
	}

	found := false

	for _, e := range entries {
		if strings.EqualFold(e.MAC, mac) {
			state.IP = types.StringValue(e.IP)
			found = true

			break
		}
	}

	if !found {
		resp.State.RemoveResource(ctx)

		return
	}

	if hostname, ok := hostnames[mac]; ok && hostname != "" {
		state.Hostname = types.StringValue(hostname)
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

	entries, hostnames, err := r.readLeases(ctx)
	if err != nil {
		resp.Diagnostics.AddError("Failed to read DHCP leases", err.Error())

		return
	}

	for i, e := range entries {
		if strings.EqualFold(e.MAC, mac) {
			entries[i].IP = plan.IP.ValueString()

			break
		}
	}

	if !plan.Hostname.IsNull() && plan.Hostname.ValueString() != "" {
		hostnames[mac] = plan.Hostname.ValueString()
	} else {
		delete(hostnames, mac)
	}

	if err := r.writeLeases(ctx, entries, hostnames); err != nil {
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

	entries, hostnames, err := r.readLeases(ctx)
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

	delete(hostnames, mac)

	if err := r.writeLeases(ctx, filtered, hostnames); err != nil {
		resp.Diagnostics.AddError("Failed to write DHCP leases", err.Error())
	}
}

func (r *dhcpStaticLeaseResource) readLeases(ctx context.Context) ([]client.DHCPStaticEntry, map[string]string, error) {
	result, err := r.client.NvramGet(ctx, []string{"dhcp_staticlist", "dhcp_hostnames"})
	if err != nil {
		return nil, nil, fmt.Errorf("reading DHCP NVRAM: %w", err)
	}

	entries := client.ParseDHCPStaticList(result["dhcp_staticlist"])
	hostnames := client.ParseDHCPHostnames(result["dhcp_hostnames"])

	return entries, hostnames, nil
}

func (r *dhcpStaticLeaseResource) writeLeases(ctx context.Context, entries []client.DHCPStaticEntry, hostnames map[string]string) error {
	values := map[string]string{
		"dhcp_staticlist": client.SerializeDHCPStaticList(entries),
		"dhcp_hostnames":  client.SerializeDHCPHostnames(hostnames),
	}

	if err := r.client.NvramSet(ctx, values, client.ServiceDNSMasq); err != nil {
		return fmt.Errorf("writing DHCP NVRAM: %w", err)
	}

	return nil
}
