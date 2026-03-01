package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/shepherdjerred/terraform-provider-asuswrt/internal/client"
)

var (
	_ resource.Resource              = &nvramResource{}
	_ resource.ResourceWithConfigure = &nvramResource{}
)

type nvramResource struct {
	client *client.Client
}

type nvramResourceModel struct {
	Key            types.String `tfsdk:"key"`
	Value          types.String `tfsdk:"value"`
	ServiceRestart types.String `tfsdk:"service_restart"`
}

// NewNvramResource returns a new NVRAM resource.
func NewNvramResource() resource.Resource {
	return &nvramResource{}
}

func (r *nvramResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_nvram"
}

func (r *nvramResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages a single NVRAM key-value pair on the router. Use this as an escape hatch for keys not covered by typed resources.",
		Attributes: map[string]schema.Attribute{
			"key": schema.StringAttribute{
				Description: "NVRAM key name.",
				Required:    true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
			},
			"value": schema.StringAttribute{
				Description: "Value to set.",
				Required:    true,
			},
			"service_restart": schema.StringAttribute{
				Description: "Service to restart after applying (e.g., restart_firewall).",
				Optional:    true,
			},
		},
	}
}

func (r *nvramResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

func (r *nvramResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan nvramResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	err := r.client.NvramSet(ctx, map[string]string{
		plan.Key.ValueString(): plan.Value.ValueString(),
	}, plan.ServiceRestart.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Failed to set NVRAM", err.Error())

		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *nvramResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state nvramResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	val, err := r.client.NvramGetSingle(ctx, state.Key.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Failed to read NVRAM", err.Error())

		return
	}

	state.Value = types.StringValue(val)

	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *nvramResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan nvramResourceModel

	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	err := r.client.NvramSet(ctx, map[string]string{
		plan.Key.ValueString(): plan.Value.ValueString(),
	}, plan.ServiceRestart.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Failed to set NVRAM", err.Error())

		return
	}

	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *nvramResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state nvramResourceModel

	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	err := r.client.NvramSet(ctx, map[string]string{
		state.Key.ValueString(): "",
	}, state.ServiceRestart.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Failed to clear NVRAM", err.Error())
	}
}
