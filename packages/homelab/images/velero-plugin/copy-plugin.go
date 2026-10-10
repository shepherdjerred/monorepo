// This standalone init entrypoint keeps the plugin image free of a shell.
package main

import (
	"log"
	"os"
)

func main() {
	data, err := os.ReadFile("/velero-blockstore-openebs")
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile("/target/velero-blockstore-openebs", data, 0755); err != nil {
		log.Fatal(err)
	}
}
