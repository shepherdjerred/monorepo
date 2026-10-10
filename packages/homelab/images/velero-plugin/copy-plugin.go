// This standalone init entrypoint keeps the plugin image free of a shell.
package main

import (
	"log"
	"os"
)

func main() {
	if err := installPlugin(); err != nil {
		log.Fatal(err)
	}
}

func installPlugin() error {
	data, err := os.ReadFile("/velero-blockstore-openebs")
	if err != nil {
		return err
	}
	file, err := os.CreateTemp("/target", ".velero-blockstore-openebs-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err := file.Chmod(0755); err != nil {
		return err
	}
	if _, err := file.Write(data); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), "/target/velero-blockstore-openebs")
}
