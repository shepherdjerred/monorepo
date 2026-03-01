package provider_test

import (
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
)

func TestAccDHCPStaticLeaseResource_basic(t *testing.T) {
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
resource "asuswrt_dhcp_static_lease" "test" {
  mac      = "AA:BB:CC:DD:EE:FF"
  ip       = "192.168.1.100"
  hostname = "homeserver"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_dhcp_static_lease.test", "mac", "AA:BB:CC:DD:EE:FF"),
					resource.TestCheckResourceAttr("asuswrt_dhcp_static_lease.test", "ip", "192.168.1.100"),
					resource.TestCheckResourceAttr("asuswrt_dhcp_static_lease.test", "hostname", "homeserver"),
				),
			},
			// Update IP
			{
				Config: cfg + `
resource "asuswrt_dhcp_static_lease" "test" {
  mac      = "AA:BB:CC:DD:EE:FF"
  ip       = "192.168.1.200"
  hostname = "homeserver"
}`,
				Check: resource.TestCheckResourceAttr("asuswrt_dhcp_static_lease.test", "ip", "192.168.1.200"),
			},
		},
	})
}

func TestAccDHCPStaticLeaseResource_withoutHostname(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_dhcp_static_lease" "nohostname" {
  mac = "11:22:33:44:55:66"
  ip  = "192.168.1.50"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_dhcp_static_lease.nohostname", "mac", "11:22:33:44:55:66"),
					resource.TestCheckResourceAttr("asuswrt_dhcp_static_lease.nohostname", "ip", "192.168.1.50"),
				),
			},
		},
	})
}

func TestAccDHCPStaticLeaseResource_multipleLeases(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_dhcp_static_lease" "lease1" {
  mac      = "AA:BB:CC:DD:EE:01"
  ip       = "192.168.1.101"
  hostname = "device1"
}

resource "asuswrt_dhcp_static_lease" "lease2" {
  mac      = "AA:BB:CC:DD:EE:02"
  ip       = "192.168.1.102"
  hostname = "device2"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_dhcp_static_lease.lease1", "ip", "192.168.1.101"),
					resource.TestCheckResourceAttr("asuswrt_dhcp_static_lease.lease2", "ip", "192.168.1.102"),
				),
			},
		},
	})
}
