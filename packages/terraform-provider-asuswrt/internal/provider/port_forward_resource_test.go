package provider_test

import (
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
)

func TestAccPortForwardResource_basic(t *testing.T) {
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
resource "asuswrt_port_forward" "http" {
  name          = "HTTP"
  protocol      = "tcp"
  external_port = "80"
  internal_ip   = "192.168.1.100"
  internal_port = "80"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_port_forward.http", "name", "HTTP"),
					resource.TestCheckResourceAttr("asuswrt_port_forward.http", "protocol", "tcp"),
					resource.TestCheckResourceAttr("asuswrt_port_forward.http", "external_port", "80"),
					resource.TestCheckResourceAttr("asuswrt_port_forward.http", "internal_ip", "192.168.1.100"),
					resource.TestCheckResourceAttr("asuswrt_port_forward.http", "internal_port", "80"),
				),
			},
			// Update port
			{
				Config: cfg + `
resource "asuswrt_port_forward" "http" {
  name          = "HTTP"
  protocol      = "tcp"
  external_port = "8080"
  internal_ip   = "192.168.1.100"
  internal_port = "80"
}`,
				Check: resource.TestCheckResourceAttr("asuswrt_port_forward.http", "external_port", "8080"),
			},
		},
	})
}

func TestAccPortForwardResource_withSourceIP(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_port_forward" "ssh" {
  name          = "SSH"
  protocol      = "tcp"
  external_port = "2222"
  internal_ip   = "192.168.1.50"
  internal_port = "22"
  source_ip     = "10.0.0.1"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_port_forward.ssh", "name", "SSH"),
					resource.TestCheckResourceAttr("asuswrt_port_forward.ssh", "source_ip", "10.0.0.1"),
				),
			},
		},
	})
}

func TestAccPortForwardResource_multipleRules(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_port_forward" "http" {
  name          = "HTTP"
  protocol      = "tcp"
  external_port = "80"
  internal_ip   = "192.168.1.100"
  internal_port = "80"
}

resource "asuswrt_port_forward" "ssh" {
  name          = "SSH"
  protocol      = "tcp"
  external_port = "22"
  internal_ip   = "192.168.1.50"
  internal_port = "22"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_port_forward.http", "name", "HTTP"),
					resource.TestCheckResourceAttr("asuswrt_port_forward.ssh", "name", "SSH"),
				),
			},
		},
	})
}
