package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/types"
)

var _ resource.Resource = &byokResource{}
var _ resource.ResourceWithConfigure = &byokResource{}

type byokResource struct {
	client *client
}

type byokModel struct {
	ID            types.String `tfsdk:"id"`
	Provider      types.String `tfsdk:"provider_name"`
	Key           types.String `tfsdk:"key"`
	Name          types.String `tfsdk:"name"`
	WorkspaceID   types.String `tfsdk:"workspace_id"`
	AllowedModels types.Set    `tfsdk:"allowed_models"`
	AllowedUsers  types.Set    `tfsdk:"allowed_user_ids"`
	Disabled      types.Bool   `tfsdk:"disabled"`
	IsFallback    types.Bool   `tfsdk:"is_fallback"`
	Label         types.String `tfsdk:"label"`
	SortOrder     types.Int64  `tfsdk:"sort_order"`
}

func newBYOKResource() resource.Resource { return &byokResource{} }

func (r *byokResource) Metadata(_ context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_credential"
}

func (r *byokResource) Schema(_ context.Context, _ resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Manages an OpenRouter BYOK credential. The key is write-only and replacement rotates it.",
		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{Computed: true},
			"provider_name": schema.StringAttribute{
				Required:      true,
				PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()},
			},
			"key": schema.StringAttribute{
				Required:      true,
				Sensitive:     true,
				PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()},
			},
			"name":             schema.StringAttribute{Optional: true},
			"workspace_id":     schema.StringAttribute{Optional: true},
			"allowed_models":   schema.SetAttribute{Optional: true, ElementType: types.StringType},
			"allowed_user_ids": schema.SetAttribute{Optional: true, ElementType: types.StringType},
			"disabled":         schema.BoolAttribute{Optional: true},
			"is_fallback":      schema.BoolAttribute{Optional: true},
			"label":            schema.StringAttribute{Computed: true},
			"sort_order":       schema.Int64Attribute{Computed: true},
		},
	}
}

func (r *byokResource) Configure(_ context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}
	c, ok := req.ProviderData.(*client)
	if !ok {
		resp.Diagnostics.AddError("Unexpected provider data", fmt.Sprintf("expected *client, got %T", req.ProviderData))
		return
	}
	r.client = c
}

func (r *byokResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	var plan byokModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	data, err := r.client.create(ctx, requestFromModel(plan))
	if err != nil {
		resp.Diagnostics.AddError("Create OpenRouter BYOK credential", err.Error())
		return
	}
	setModelFromData(&plan, data)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *byokResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	var state byokModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	data, status, err := r.client.read(ctx, state.ID.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Read OpenRouter BYOK credential", err.Error())
		return
	}
	if status == 404 {
		resp.State.RemoveResource(ctx)
		return
	}
	setModelFromData(&state, data)
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
}

func (r *byokResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	var plan byokModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}
	var state byokModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	data, err := r.client.update(ctx, state.ID.ValueString(), requestFromModel(plan))
	if err != nil {
		resp.Diagnostics.AddError("Update OpenRouter BYOK credential", err.Error())
		return
	}
	setModelFromData(&plan, data)
	resp.Diagnostics.Append(resp.State.Set(ctx, &plan)...)
}

func (r *byokResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	var state byokModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}
	status, err := r.client.delete(ctx, state.ID.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Delete OpenRouter BYOK credential", err.Error())
		return
	}
	if status != 404 && (status < 200 || status >= 300) {
		resp.Diagnostics.AddError("Delete OpenRouter BYOK credential", fmt.Sprintf("OpenRouter BYOK API returned HTTP %d", status))
	}
}

func requestFromModel(model byokModel) byokRequest {
	return byokRequest{
		Provider:       model.Provider.ValueString(),
		Key:            model.Key.ValueString(),
		Name:           model.Name.ValueString(),
		WorkspaceID:    model.WorkspaceID.ValueString(),
		AllowedModels:  stringSet(model.AllowedModels),
		AllowedUserIDs: stringSet(model.AllowedUsers),
		Disabled:       boolPointer(model.Disabled),
		IsFallback:     boolPointer(model.IsFallback),
	}
}

func stringSet(value types.Set) []string {
	if value.IsNull() || value.IsUnknown() {
		return nil
	}
	values := value.Elements()
	result := make([]string, 0, len(values))
	for _, element := range values {
		result = append(result, element.(types.String).ValueString())
	}
	return result
}

func boolPointer(value types.Bool) *bool {
	if value.IsNull() || value.IsUnknown() {
		return nil
	}
	result := value.ValueBool()
	return &result
}

func setModelFromData(model *byokModel, data byokData) {
	model.ID = types.StringValue(data.ID)
	model.Provider = types.StringValue(data.Provider)
	model.Name = types.StringValue(data.Name)
	model.WorkspaceID = types.StringValue(data.WorkspaceID)
	if data.AllowedModels != nil {
		model.AllowedModels = stringSetValue(data.AllowedModels)
	}
	if data.AllowedUserIDs != nil {
		model.AllowedUsers = stringSetValue(data.AllowedUserIDs)
	}
	model.Disabled = types.BoolValue(data.Disabled)
	model.IsFallback = types.BoolValue(data.IsFallback)
	model.Label = types.StringValue(data.Label)
	model.SortOrder = types.Int64Value(data.SortOrder)
}

func stringSetValue(values []string) types.Set {
	elements := make([]attr.Value, 0, len(values))
	for _, value := range values {
		elements = append(elements, types.StringValue(value))
	}
	return types.SetValueMust(types.StringType, elements)
}
