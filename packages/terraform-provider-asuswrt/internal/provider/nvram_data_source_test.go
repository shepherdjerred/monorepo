package provider_test

import (
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
)

func TestAccNvramDataSource_existing(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	router.nvram["computer_name"] = "MyRouter"
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
data "asuswrt_nvram" "test" {
  key = "computer_name"
}`,
				Check: resource.TestCheckResourceAttr("data.asuswrt_nvram.test", "value", "MyRouter"),
			},
		},
	})
}

func TestAccNvramDataSource_missingKey(t *testing.T) {
	t.Parallel()
	router := newMockRouter()
	server := startMockServer(t, router)
	cfg := providerConfig(server.URL)

	resource.Test(t, resource.TestCase{
		ProtoV6ProviderFactories: TestAccProtoV6ProviderFactories,
		Steps: []resource.TestStep{
			{
				Config: cfg + `
data "asuswrt_nvram" "test" {
  key = "nonexistent_key"
}`,
				Check: resource.TestCheckResourceAttr("data.asuswrt_nvram.test", "value", ""),
			},
		},
	})
}
