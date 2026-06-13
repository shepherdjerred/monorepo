import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { requireContainerResources } from "./require-container-resources.ts";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: false,
    },
  },
});

ruleTester.run("require-container-resources", requireContainerResources, {
  valid: [
    {
      // Explicit real resources
      code: `deployment.addContainer({ name: "app", image: "x", resources: { cpu: { request: Cpu.millis(50) } } });`,
    },
    {
      // Explicit BestEffort opt-in
      code: `deployment.addContainer({ name: "app", image: "x", resources: {} });`,
    },
    {
      // Wrapped in withCommonProps with explicit resources
      code: `deployment.addContainer(withCommonProps({ image: "x", resources: { cpu: { request: Cpu.millis(50) } } }));`,
    },
    {
      // Wrapped BestEffort opt-in
      code: `deployment.addContainer(withCommonLinuxServerProps({ image: "x", resources: {} }));`,
    },
    {
      // String key counts
      code: `deployment.addContainer({ image: "x", "resources": {} });`,
    },
    {
      // Spread may carry resources — not statically provable, skipped
      code: `deployment.addContainer({ ...baseProps, image: "x" });`,
    },
    {
      // Identifier argument — not statically analyzable, skipped
      code: `deployment.addContainer(props);`,
    },
    {
      // Unknown wrapper — not statically analyzable, skipped
      code: `deployment.addContainer(buildProps({ image: "x" }));`,
    },
    {
      // Unrelated method
      code: `deployment.addVolume({ name: "data" });`,
    },
    {
      // Init container with resources
      code: `deployment.addInitContainer({ name: "init", image: "x", resources: {} });`,
    },
  ],
  invalid: [
    {
      code: `deployment.addContainer({ name: "app", image: "x" });`,
      errors: [{ messageId: "missingResources" }],
    },
    {
      code: `deployment.addInitContainer({ name: "init", image: "x" });`,
      errors: [{ messageId: "missingResources" }],
    },
    {
      code: `deployment.addContainer(withCommonProps({ image: "x", ports: [{ number: 80 }] }));`,
      errors: [{ messageId: "missingResources" }],
    },
    {
      code: `deployment.addContainer(withCommonLinuxServerProps({ image: "x" }));`,
      errors: [{ messageId: "missingResources" }],
    },
    {
      code: `daemonSet.addContainer({ name: "collector", image: "alpine", command: ["/bin/sh"] });`,
      errors: [{ messageId: "missingResources" }],
    },
  ],
});
