// Package provider implements the Asuswrt-Merlin Terraform provider.
package provider

import (
	"context"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/path"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"

	"github.com/shepherdjerred/terraform-provider-asuswrt/internal/client"
)

var _ provider.Provider = &asuswrtProvider{}

type asuswrtProvider struct {
	version string
}

type asuswrtProviderModel struct {
	Host     types.String `tfsdk:"host"`
	Username types.String `tfsdk:"username"`
	Password types.String `tfsdk:"password"`
	HTTPS    types.Bool   `tfsdk:"https"`
	Port     types.Int64  `tfsdk:"port"`
	Insecure types.Bool   `tfsdk:"insecure"`
}

// New returns a provider.Provider constructor function.
func New(version string) func() provider.Provider {
	return func() provider.Provider {
		return &asuswrtProvider{
			version: version,
		}
	}
}

func (p *asuswrtProvider) Metadata(_ context.Context, _ provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "asuswrt"
	resp.Version = p.version
}

func (p *asuswrtProvider) Schema(_ context.Context, _ provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		Description: "Provider for managing Asuswrt-Merlin router configuration via its HTTP API.",
		Attributes: map[string]schema.Attribute{
			"host": schema.StringAttribute{
				Description: "Router hostname or IP address.",
				Required:    true,
			},
			"username": schema.StringAttribute{
				Description: "Router admin username.",
				Required:    true,
			},
			"password": schema.StringAttribute{
				Description: "Router admin password.",
				Required:    true,
				Sensitive:   true,
			},
			"https": schema.BoolAttribute{
				Description: "Use HTTPS to connect. Default: false.",
				Optional:    true,
			},
			"port": schema.Int64Attribute{
				Description: "Port number. Default: 80 (HTTP) or 8443 (HTTPS).",
				Optional:    true,
			},
			"insecure": schema.BoolAttribute{
				Description: "Skip TLS certificate verification. Default: false.",
				Optional:    true,
			},
		},
	}
}

func (p *asuswrtProvider) Configure(ctx context.Context, req provider.ConfigureRequest, resp *provider.ConfigureResponse) {
	var config asuswrtProviderModel

	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	if config.Host.IsUnknown() {
		resp.Diagnostics.AddAttributeError(
			path.Root("host"), "Unknown host", "The provider cannot create the client with an unknown host value.",
		)

		return
	}

	cfg := client.Config{
		Host:     config.Host.ValueString(),
		Username: config.Username.ValueString(),
		Password: config.Password.ValueString(),
		HTTPS:    config.HTTPS.ValueBool(),
		Port:     int(config.Port.ValueInt64()),
		Insecure: config.Insecure.ValueBool(),
	}

	c := client.New(cfg)

	resp.DataSourceData = c
	resp.ResourceData = c
}

func (p *asuswrtProvider) Resources(_ context.Context) []func() resource.Resource {
	return []func() resource.Resource{
		NewNvramResource,
		NewSystemResource,
		NewDHCPStaticLeaseResource,
		NewWirelessNetworkResource,
		NewPortForwardResource,
	}
}

func (p *asuswrtProvider) DataSources(_ context.Context) []func() datasource.DataSource {
	return []func() datasource.DataSource{
		NewNvramDataSource,
	}
}
