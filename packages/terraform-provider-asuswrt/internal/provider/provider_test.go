package provider_test

import (
	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"

	"github.com/shepherdjerred/terraform-provider-asuswrt/internal/provider"
)

// TestAccProtoV6ProviderFactories returns provider factories for acceptance tests.
var TestAccProtoV6ProviderFactories = map[string]func() (tfprotov6.ProviderServer, error){
	"asuswrt": providerserver.NewProtocol6WithError(provider.New("test")()),
}
