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

const PodSpecSchema = z.object({
  containers: z.array(ContainerSchema),
  initContainers: z.array(ContainerSchema).optional(),
});

// Every synthesized Job/Deployment here has exactly one container; find it
// and fail with a resource-specific message if the shape ever changes.
function firstContainer(resourceSpec: unknown, description: string) {
  const spec = z
    .object({ template: z.object({ spec: PodSpecSchema }) })
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

    // Aggregate counters alone can be positive purely because OTHER
    // backup-enabled PVCs succeeded; the preflight must specifically confirm
    // the Temporal PVC's own snapshot, not just any completed snapshot.
    expect(command).toContain("pgdata-temporal-postgresql-0");
    expect(command).toContain("velero.io/backup=enabled");
    expect(command).toContain("enabled_pvc_count");
    expect(command).toContain('snapshots_attempted" -ne "$enabled_pvc_count');
  });

  test("stages backup-preflight RBAC as an earlier PreSync hook than the Job it serves", () => {
    const rbacAnnotations = {
      "argocd.argoproj.io/hook": "PreSync",
      "argocd.argoproj.io/sync-wave": "-3",
    };

    expect(
      findResource("ServiceAccount", "temporal-backup-preflight").metadata
        .annotations,
    ).toMatchObject(rbacAnnotations);
    expect(
      findResource("Role", "temporal-backup-preflight").metadata.annotations,
    ).toMatchObject(rbacAnnotations);
    expect(
      findResource("RoleBinding", "temporal-backup-preflight").metadata
        .annotations,
    ).toMatchObject(rbacAnnotations);
    expect(
      findResource("ClusterRole", "temporal-backup-preflight-pvc-reader")
        .metadata.annotations,
    ).toMatchObject(rbacAnnotations);
    expect(
      findResource("ClusterRoleBinding", "temporal-backup-preflight-pvc-reader")
        .metadata.annotations,
    ).toMatchObject(rbacAnnotations);

    // The RBAC's wave (-3) must sort strictly before the Job's own wave (-2)
    // within the shared PreSync hook phase.
    const rbacWave = Number(rbacAnnotations["argocd.argoproj.io/sync-wave"]);
    const jobWave = Number(
      findResource("Job", "temporal-backup-preflight").metadata.annotations?.[
        "argocd.argoproj.io/sync-wave"
      ],
    );
    expect(rbacWave).toBeLessThan(jobWave);
  });

  test("migrates both schemas in a blocking Sync hook", () => {
    const job = findResource("Job", "temporal-schema-migration");
    // Sync, not PreSync: PreSync completes as its own phase before any
    // ordinary resource is applied, and this job mounts a secret cert-manager
    // only issues from a Certificate in the Sync phase. See the phase-ordering
    // test below, which is the guard that this cannot regress.
    expect(job.metadata.annotations).toMatchObject({
      "argocd.argoproj.io/hook": "Sync",
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

    // Must trust the stable CA (ca.crt), not the rotating leaf's own
    // certificate (tls.crt) — trusting the leaf would work until its next
    // cert-manager renewal, then silently fail.
    const caFileEnv = container.env?.find(
      (entry) => entry.name === "POSTGRES_TLS_CA_FILE",
    );
    expect(caFileEnv?.value).toBe("/etc/temporal/postgres-tls/ca.crt");
  });

  // The invariant nothing asserted, and which a PreSync migration violated:
  // ArgoCD runs PreSync as a whole phase before the Sync phase applies any
  // ordinary resource, so a hook may only depend on ordinary resources that
  // share its phase and sort earlier by wave. The migration mounts
  // `temporal-postgresql-tls`, talks to the database, and is covered by its own
  // egress policy — all three are ordinary Sync-phase resources.
  test("orders the schema migration after everything it needs and before the server", () => {
    const phase = (kind: string, name: string) =>
      findResource(kind, name).metadata.annotations?.[
        "argocd.argoproj.io/hook"
      ] ?? "Sync";
    const wave = (kind: string, name: string) =>
      Number(
        findResource(kind, name).metadata.annotations?.[
          "argocd.argoproj.io/sync-wave"
        ] ?? "0",
      );

    const migrationWave = wave("Job", "temporal-schema-migration");
    expect(phase("Job", "temporal-schema-migration")).toBe("Sync");

    // Each prerequisite is an ordinary Sync-phase resource, so it must both
    // share the phase and sort strictly earlier.
    for (const [kind, name] of [
      ["Certificate", "temporal-postgresql"],
      ["postgresql", "temporal-postgresql"],
      ["NetworkPolicy", "temporal-schema-migration-netpol"],
    ] as const) {
      expect(phase(kind, name)).toBe("Sync");
      expect(wave(kind, name)).toBeLessThan(migrationWave);
    }

    // The secret the migration mounts is the one that Certificate issues.
    const certificate = z
      .object({ spec: z.object({ secretName: z.string() }).loose() })
      .parse(findResource("Certificate", "temporal-postgresql"));
    expect(certificate.spec.secretName).toBe("temporal-postgresql-tls");
    expect(
      JSON.stringify(findResource("Job", "temporal-schema-migration")),
    ).toContain("temporal-postgresql-tls");

    // And the server must not boot against an unmigrated schema.
    expect(phase("Deployment", "temporal-temporal-server")).toBe("Sync");
    expect(migrationWave).toBeLessThan(
      wave("Deployment", "temporal-temporal-server"),
    );
  });

  test("stages the PostgreSQL ingress netpol ahead of the schema migration Job", () => {
    const netpol = findResource("NetworkPolicy", "temporal-postgresql-netpol");
    expect(netpol.metadata.annotations).toMatchObject({
      "argocd.argoproj.io/hook": "PreSync",
      "argocd.argoproj.io/sync-wave": "-3",
    });

    // The netpol is a PreSync hook and the migration a Sync hook, so the whole
    // PreSync phase — not a wave comparison — is what orders them.
    const schemaJob = findResource("Job", "temporal-schema-migration");
    expect(schemaJob.metadata.annotations?.["argocd.argoproj.io/hook"]).toBe(
      "Sync",
    );

    const serialized = JSON.stringify(netpol.spec);
    expect(serialized).toContain('"app":"temporal-server"');
    expect(serialized).toContain('"app":"temporal-schema-migration"');
  });

  test("starts the server without schema setup and verifies PostgreSQL identity", () => {
    const deployment = findResource("Deployment", "temporal-temporal-server");
    const container = firstContainer(deployment.spec, "Temporal server");

    expect(container.image).toContain("temporalio/server:1.30.6@sha256:");
    expect(container.args?.join(" ") ?? "").not.toContain("autosetup");
    expect(container.securityContext.readOnlyRootFilesystem).toBe(true);
    expect(container.volumeMounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mountPath: "/etc/temporal/postgres-tls" }),
        expect.objectContaining({ mountPath: "/etc/temporal/config" }),
      ]),
    );

    // The DB_*/POSTGRES_*/SQL_* variables that used to carry this
    // configuration were dockerize template inputs read by the auto-setup
    // image. temporalio/server renders no template and expands no
    // environment variables, so leaving them here would look like
    // configuration while configuring nothing. The credential in particular
    // must not be in this container: only the init container renders it.
    const env = new Map(
      (container.env ?? []).map((entry) => [entry.name, entry.value]),
    );
    for (const inert of [
      "DB",
      "POSTGRES_SEEDS",
      "POSTGRES_PWD",
      "SQL_TLS_ENABLED",
      "SQL_CA",
      "SQL_HOST_VERIFICATION",
      "NUM_HISTORY_SHARDS",
      "SERVICES",
    ]) {
      expect(env.has(inert)).toBe(false);
    }
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
