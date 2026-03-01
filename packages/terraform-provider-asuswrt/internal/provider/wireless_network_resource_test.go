package provider_test

import (
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
)

func TestAccWirelessNetworkResource_basic24GHz(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_wireless_network" "wifi24" {
  band      = 0
  ssid      = "MyWiFi"
  auth_mode = "psk2"
  crypto    = "aes"
  wpa_passphrase = "supersecret123"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_wireless_network.wifi24", "id", "wl0"),
					resource.TestCheckResourceAttr("asuswrt_wireless_network.wifi24", "band", "0"),
					resource.TestCheckResourceAttr("asuswrt_wireless_network.wifi24", "ssid", "MyWiFi"),
					resource.TestCheckResourceAttr("asuswrt_wireless_network.wifi24", "auth_mode", "psk2"),
					resource.TestCheckResourceAttr("asuswrt_wireless_network.wifi24", "crypto", "aes"),
				),
			},
			// Update SSID
			{
				Config: cfg + `
resource "asuswrt_wireless_network" "wifi24" {
  band      = 0
  ssid      = "UpdatedWiFi"
  auth_mode = "psk2"
  crypto    = "aes"
  wpa_passphrase = "supersecret123"
}`,
				Check: resource.TestCheckResourceAttr("asuswrt_wireless_network.wifi24", "ssid", "UpdatedWiFi"),
			},
		},
	})
}

func TestAccWirelessNetworkResource_5GHz(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_wireless_network" "wifi5" {
  band      = 1
  ssid      = "MyWiFi-5G"
  auth_mode = "psk2"
  crypto    = "aes"
  wpa_passphrase = "password5g"
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_wireless_network.wifi5", "id", "wl1"),
					resource.TestCheckResourceAttr("asuswrt_wireless_network.wifi5", "ssid", "MyWiFi-5G"),
				),
			},
		},
	})
}

func TestAccWirelessNetworkResource_autoChannel(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_wireless_network" "auto" {
  band      = 0
  ssid      = "AutoChannel"
  auth_mode = "psk2"
  channel   = 0
  bandwidth = 2
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_wireless_network.auto", "ssid", "AutoChannel"),
					resource.TestCheckResourceAttr("asuswrt_wireless_network.auto", "channel", "0"),
					resource.TestCheckResourceAttr("asuswrt_wireless_network.auto", "bandwidth", "2"),
				),
			},
		},
	})
}

func TestAccWirelessNetworkResource_hidden(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
resource "asuswrt_wireless_network" "hidden" {
  band      = 0
  ssid      = "HiddenNet"
  auth_mode = "psk2"
  hidden    = true
}`,
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr("asuswrt_wireless_network.hidden", "ssid", "HiddenNet"),
					resource.TestCheckResourceAttr("asuswrt_wireless_network.hidden", "hidden", "true"),
				),
			},
		},
	})
}
