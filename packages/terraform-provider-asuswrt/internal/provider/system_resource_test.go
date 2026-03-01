package provider_test

import (
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
)

func TestAccSystemResource_hostnameOnly(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_system" "test" {
  hostname = "MyRouter"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_system.test", "id", "system"),
					resource.TestCheckResourceAttr("asuswrt_system.test", "hostname", "MyRouter"),
				),
			},
			// Update hostname
			{
				Config: cfg + `
resource "asuswrt_system" "test" {
  hostname = "NewRouter"
}`,
				Check: resource.TestCheckResourceAttr("asuswrt_system.test", "hostname", "NewRouter"),
			},
		},
	})
}

func TestAccSystemResource_allFields(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_system" "test" {
  hostname     = "Router"
  timezone     = "EST5EDT,M3.2.0,M11.1.0"
  ntp_server_0 = "pool.ntp.org"
  ntp_server_1 = "time.nist.gov"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_system.test", "id", "system"),
					resource.TestCheckResourceAttr("asuswrt_system.test", "hostname", "Router"),
					resource.TestCheckResourceAttr("asuswrt_system.test", "timezone", "EST5EDT,M3.2.0,M11.1.0"),
					resource.TestCheckResourceAttr("asuswrt_system.test", "ntp_server_0", "pool.ntp.org"),
					resource.TestCheckResourceAttr("asuswrt_system.test", "ntp_server_1", "time.nist.gov"),
				),
			},
		},
	})
}
