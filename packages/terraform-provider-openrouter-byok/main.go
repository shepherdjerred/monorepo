package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"

	"github.com/shepherdjerred/monorepo/packages/terraform-provider-openrouter-byok/internal/provider"
)

var version = "dev"

func main() {
	var debug bool
	flag.BoolVar(&debug, "debug", false, "run with debugger support")
	flag.Parse()

	err := providerserver.Serve(context.Background(), provider.New(version), providerserver.ServeOpts{
		Address: "registry.opentofu.org/shepherdjerred/openrouter-byok",
		Debug:   debug,
	})
	if err != nil {
		log.Fatal(err.Error())
	}
}
