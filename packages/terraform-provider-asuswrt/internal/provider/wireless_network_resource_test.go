package provider_test

import (
	"regexp"
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
			// Import by band index. wpa_passphrase is write-only (never read),
			// so it is excluded from the state-equality check.
			{
				ResourceName:            "asuswrt_wireless_network.wifi24",
				ImportState:             true,
				ImportStateId:           "0",
				ImportStateVerify:       true,
				ImportStateVerifyIgnore: []string{"wpa_passphrase"},
			},
		},
	})
}

// TestAccWirelessNetworkResource_importRejectsUnknownBand pins the import
// existence check. A missing NVRAM key reads back as an empty string rather
// than an error, so without the check these imports would succeed against a
// radio that does not exist and leave the required attributes empty.
func TestAccWirelessNetworkResource_importRejectsUnknownBand(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	wifi := cfg + `
resource "asuswrt_wireless_network" "wifi24" {
  band      = 0
  ssid      = "MyWiFi"
  auth_mode = "psk2"
}`

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{Config: wifi},
			{
				// Band 99 has no radio: wl99_ssid is absent.
				Config:        wifi,
				ResourceName:  "asuswrt_wireless_network.wifi24",
				ImportState:   true,
				ImportStateId: "99",
				ExpectError:   regexp.MustCompile(`no radio for band 99`),
			},
			{
				Config:        wifi,
				ResourceName:  "asuswrt_wireless_network.wifi24",
				ImportState:   true,
				ImportStateId: "-1",
				ExpectError:   regexp.MustCompile(`cannot be negative`),
			},
			{
				// The real band still imports.
				Config:            wifi,
				ResourceName:      "asuswrt_wireless_network.wifi24",
				ImportState:       true,
				ImportStateId:     "0",
				ImportStateVerify: true,
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
