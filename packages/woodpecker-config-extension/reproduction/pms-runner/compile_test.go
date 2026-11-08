package main

import (
	"encoding/json"
	"os/exec"
	"reflect"
	"testing"

	backend "go.woodpecker-ci.org/woodpecker/v3/pipeline/backend/types"
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
	planJSON, err := json.Marshal(rendered.Plan)
	if err != nil {
		t.Fatal(err)
	}
	var validated Plan
	if err = decode(planJSON, &validated); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(rendered.Plan, validated) {
		t.Fatal("shared protocol changed the actual rendered plan")
	}
	config, err := compilePlan(rendered.Plan, []byte(rendered.YAML))
	if err != nil {
		t.Fatal(err)
	}
	if config == nil {
		t.Fatal("actual workflow did not compile")
	}
	var names []string
	for _, stage := range config.Stages {
		for _, step := range stage.Steps {
			names = append(names, step.Name)
			if len(names) <= 2 && step.Type != backend.StepTypeClone {
				t.Fatal("golden cleanup and native Git must retain actual clone roles")
			}
		}
	}
	if !reflect.DeepEqual(names, []string{"clear-golden", "clone", "media-pms-wire", "media-pms-native"}) {
		t.Fatalf("actual compiled steps changed: %v", names)
	}
	for _, name := range []string{"missing cleanup", "unknown step"} {
		t.Run(name, func(t *testing.T) {
			changed := rendered.Plan
			changed.Steps = append([]PlannedStep(nil), rendered.Plan.Steps...)
			if name == "missing cleanup" {
				changed.Steps = changed.Steps[1:]
			} else {
				changed.Steps[0].Name = "unreviewed"
			}
			body, err := json.Marshal(changed)
			if err != nil {
				t.Fatal(err)
			}
			if err = decode(body, new(Plan)); err == nil {
				t.Fatal("unreviewed checkout steps passed the shared protocol")
			}
		})
	}
}
