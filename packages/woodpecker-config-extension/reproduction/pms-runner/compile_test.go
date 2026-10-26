package main

import (
	"encoding/json"
	"os/exec"
	"testing"
)

// Exercise the actual TypeScript emitter through the pinned public compiler.
// This stops before kubeconfig, resource constructors or backend execution.
func TestActualRenderedWorkflowCompiles(t *testing.T) {
	command := exec.Command("bun", "-e", `
import {renderPmsReproduction} from "./src/reproduction/media-pms.ts";
import {TEST_IMAGES} from "./test/identity.ts";
const result = renderPmsReproduction({
  source: "a".repeat(40), branch: "feature/media",
  requestId: "d10ddcc4-2245-4774-b49a-a4a51abcfaf8",
}, TEST_IMAGES);
process.stdout.write(JSON.stringify(result));
`)
	command.Dir = "../.."
	output, err := command.Output()
	if err != nil {
		t.Fatalf("actual emitter failed: %v", err)
	}
	var rendered struct {
		Plan Plan   `json:"plan"`
		YAML string `json:"yaml"`
	}
	if err = json.Unmarshal(output, &rendered); err != nil {
		t.Fatal(err)
	}
	config, err := compilePlan(rendered.Plan, []byte(rendered.YAML))
	if err != nil {
		t.Fatal(err)
	}
	if config == nil {
		t.Fatal("actual workflow did not compile")
	}
}
