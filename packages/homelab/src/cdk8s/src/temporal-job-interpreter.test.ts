import { describe, expect, test } from "vitest";
import { z } from "zod";
import { synthesizeTemporalResources } from "./temporal-test-resources.ts";

const PodSpecSchema = z.object({
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z.object({
            image: z.string(),
            command: z.array(z.string()).optional(),
            args: z.array(z.string()).optional(),
          }),
        ),
      }),
    }),
  }),
});

/**
 * `temporalio/admin-tools` is an Alpine image: it provides BusyBox `sh` and
 * `ash` and no bash whatsoever. Naming an absent interpreter fails inside the
 * OCI runtime before the container's first instruction, so the pod reports
 * StartError and `kubectl logs` returns nothing at all — the schema migration
 * spent a full ArgoCD sync failing that way with no diagnostic output.
 *
 * A missing interpreter is invisible to typecheck, lint and rendering alike,
 * so pin it here for every job built on that image.
 */
/**
 * Inside a String.raw template `\\` is two literal backslashes, not an escaped
 * one, so a shell line continuation written that way passes a bare `\` as an
 * argument and ends the command. The schema migration shipped exactly that and
 * died with `No help topic for '\'` after the interpreter fix let it run at
 * all. The rendered YAML is the only place this is visible — the TypeScript
 * compiles, lints and renders fine.
 */
describe("Temporal job shell scripts", () => {
  test("continue lines with a single backslash, not a literal one", () => {
    const scripts = synthesizeTemporalResources(".test-synth-temporal-scripts")
      .filter((resource) => resource.kind === "Job")
      .map((resource) => PodSpecSchema.parse(resource))
      .flatMap((job) => job.spec.template.spec.containers)
      .flatMap((container) => container.args ?? []);

    expect(scripts.length).toBeGreaterThan(0);

    const offenders = scripts.flatMap((script) =>
      script
        .split("\n")
        .filter((line) => /\\\\$/.test(line))
        .map((line) => line.trim()),
    );
    expect(offenders).toStrictEqual([]);
  });
});

describe("Temporal admin-tools jobs", () => {
  test("invoke an interpreter the admin-tools image actually ships", () => {
    const jobs = synthesizeTemporalResources(".test-synth-temporal-interpreter")
      .filter((resource) => resource.kind === "Job")
      .map((resource) => PodSpecSchema.parse(resource))
      .flatMap((job) => job.spec.template.spec.containers)
      .filter((container) =>
        container.image.includes("temporalio/admin-tools"),
      );

    // Guard the guard: a filter that silently matched nothing would pass.
    expect(jobs.length).toBeGreaterThanOrEqual(2);

    for (const container of jobs) {
      expect(container.command?.[0]).toBe("/bin/sh");
    }
  });
});
