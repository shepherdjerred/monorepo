package provider_test

import (
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
)

func TestAccNvramResource_basic(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			// Create
			{
				Config: cfg + `
resource "asuswrt_nvram" "test" {
  key   = "test_key"
  value = "test_value"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_nvram.test", "key", "test_key"),
					resource.TestCheckResourceAttr("asuswrt_nvram.test", "value", "test_value"),
				),
			},
			// Update value
			{
				Config: cfg + `
resource "asuswrt_nvram" "test" {
  key   = "test_key"
  value = "updated_value"
}`,
				Check: resource.TestCheckResourceAttr("asuswrt_nvram.test", "value", "updated_value"),
			},
		},
	})
}

func TestAccNvramResource_withServiceRestart(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_nvram" "svc" {
  key             = "wl0_ssid"
  value           = "MyNetwork"
  service_restart = "restart_wireless"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_nvram.svc", "key", "wl0_ssid"),
					resource.TestCheckResourceAttr("asuswrt_nvram.svc", "value", "MyNetwork"),
					resource.TestCheckResourceAttr("asuswrt_nvram.svc", "service_restart", "restart_wireless"),
				),
			},
		},
	})
}
