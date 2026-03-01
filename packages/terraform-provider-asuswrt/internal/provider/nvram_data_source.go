package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/shepherdjerred/terraform-provider-asuswrt/internal/client"
)

var (
	_ datasource.DataSource              = &nvramDataSource{}
	_ datasource.DataSourceWithConfigure = &nvramDataSource{}
)

type nvramDataSource struct {
	client *client.Client
}

type nvramDataSourceModel struct {
	Key   types.String `tfsdk:"key"`
	Value types.String `tfsdk:"value"`
}

// NewNvramDataSource returns a new NVRAM data source.
func NewNvramDataSource() datasource.DataSource {
	return &nvramDataSource{}
}

func (d *nvramDataSource) Metadata(_ context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_nvram"
}

func (d *nvramDataSource) Schema(_ context.Context, _ datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Reads a single NVRAM key from the router.",
		Attributes: map[string]schema.Attribute{
			"key": schema.StringAttribute{
				Description: "NVRAM key name to read.",
				Required:    true,
			},
			"value": schema.StringAttribute{
				Description: "Current value of the NVRAM key.",
				Computed:    true,
			},
		},
	}
}

func (d *nvramDataSource) Configure(_ context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	if req.ProviderData == nil {
		return
	}

	c, ok := req.ProviderData.(*client.Client)
	if !ok {
		resp.Diagnostics.AddError("Unexpected provider data type", fmt.Sprintf("Expected *client.Client, got %T", req.ProviderData))

		return
	}

	d.client = c
}

func (d *nvramDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	var config nvramDataSourceModel

	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	val, err := d.client.NvramGetSingle(ctx, config.Key.ValueString())
	if err != nil {
		resp.Diagnostics.AddError("Failed to read NVRAM", err.Error())

		return
	}

	config.Value = types.StringValue(val)

	resp.Diagnostics.Append(resp.State.Set(ctx, &config)...)
}
