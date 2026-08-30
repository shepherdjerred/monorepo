import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createTemporalChart } from "./cdk8s-charts/temporal.ts";

const ResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z
      .object({
        name: z.string(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .loose(),
    spec: z.unknown().optional(),
  })
  .loose();

function resources() {
  const app = new App({ outdir: ".test-synth-temporal-server-lifecycle" });
  createTemporalChart(app);
  return parseAllDocuments(app.synthYaml()).flatMap((document) => {
    const parsed = ResourceSchema.safeParse(document.toJSON());
    return parsed.success ? [parsed.data] : [];
  });
}

function findResource(kind: string, name: string) {
  const resource = resources().find(
    (candidate) => candidate.kind === kind && candidate.metadata.name === name,
  );
  if (resource === undefined) {
    throw new Error(`Missing ${kind}/${name}`);
  }
  return resource;
}

const ContainerSchema = z.object({
  name: z.string(),
  image: z.string(),
  args: z.array(z.string()).optional(),
  env: z
    .array(
      z
        .object({
          name: z.string(),
          value: z.string().optional(),
        })
        .loose(),
    )
    .optional(),
  securityContext: z.object({ readOnlyRootFilesystem: z.boolean() }).loose(),
  volumeMounts: z
    .array(z.object({ name: z.string(), mountPath: z.string() }).loose())
    .optional(),
});

// Every synthesized Job/Deployment here has exactly one container; find it
// and fail with a resource-specific message if the shape ever changes.
function firstContainer(resourceSpec: unknown, description: string) {
  const spec = z
    .object({
      template: z.object({
        spec: z.object({ containers: z.array(ContainerSchema) }),
      }),
    })
    .parse(resourceSpec);
  const container = spec.template.spec.containers[0];
  if (container === undefined) {
    throw new Error(`${description} container was not synthesized`);
  }
  return container;
}

describe("Temporal server lifecycle", () => {
  test("requires a fresh successful volume backup before migration", () => {
    const job = findResource("Job", "temporal-backup-preflight");
    expect(job.metadata.annotations).toMatchObject({
      "argocd.argoproj.io/hook": "PreSync",
      "argocd.argoproj.io/sync-wave": "-2",
    });

    const container = firstContainer(job.spec, "Backup preflight");
    const command = container.args?.join("\n") ?? "";

    expect(container.image).toContain("bitnamilegacy/kubectl:1.33.4@sha256:");
    expect(command).toContain("velero.io/schedule-name=6hourly-backup");
    expect(command).toContain('phase" != "Completed');
    expect(command).toContain('errors" -ne 0');
    expect(command).toContain('snapshots_attempted" -le 0');
    expect(command).toContain('age_seconds" -gt 25200');
  });

  test("migrates both schemas in a blocking PreSync hook", () => {
    const job = findResource("Job", "temporal-schema-migration");
    expect(job.metadata.annotations).toMatchObject({
      "argocd.argoproj.io/hook": "PreSync",
      "argocd.argoproj.io/hook-delete-policy":
        "BeforeHookCreation,HookSucceeded",
    });

    const container = firstContainer(job.spec, "Schema migration");
    const command = container.args?.join("\n") ?? "";

    expect(container.image).toContain("temporalio/admin-tools:1.30.6@sha256:");
    expect(command).toContain(
      "update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned",
    );
    expect(command).toContain(
      "update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned",
    );
    expect(command).toContain("--tls-server-name");
    expect(command).not.toContain("disable-host-verification");
    expect(container.securityContext.readOnlyRootFilesystem).toBe(true);
  });

  test("starts the server without schema setup and verifies PostgreSQL identity", () => {
    const deployment = findResource("Deployment", "temporal-temporal-server");
    const container = firstContainer(deployment.spec, "Temporal server");
    const env = new Map(
      (container.env ?? []).map((entry) => [entry.name, entry.value]),
    );

    expect(container.image).toContain("temporalio/server:1.30.6@sha256:");
    expect(container.args?.join(" ") ?? "").not.toContain("autosetup");
    expect(env.get("POSTGRES_TLS_SERVER_NAME")).toBe(
      "temporal-postgresql.temporal.svc.cluster.local",
    );
    expect(env.get("SQL_HOST_VERIFICATION")).toBe("true");
    expect(env.has("POSTGRES_TLS_DISABLE_HOST_VERIFICATION")).toBe(false);
    expect(env.has("SQL_TLS_DISABLE_HOST_VERIFICATION")).toBe(false);
    expect(container.securityContext.readOnlyRootFilesystem).toBe(true);
    expect(container.volumeMounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mountPath: "/etc/temporal/postgres-tls" }),
        expect.objectContaining({ mountPath: "/etc/temporal/config" }),
      ]),
    );
  });

  test("limits the schema hook to DNS and PostgreSQL egress", () => {
    const policy = findResource(
      "NetworkPolicy",
      "temporal-schema-migration-netpol",
    );
    const serialized = JSON.stringify(policy.spec);

    expect(serialized).toContain('"app":"temporal-schema-migration"');
    expect(serialized).toContain('"port":53');
    expect(serialized).toContain('"port":5432');
    expect(serialized).not.toContain('"port":7233');
  });
});
