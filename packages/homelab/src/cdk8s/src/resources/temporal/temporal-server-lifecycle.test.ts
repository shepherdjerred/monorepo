import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import {
  TEMPORAL_CHILD_SYNC_TIMEOUT_SECONDS,
  TEMPORAL_SCHEMA_MIGRATION_ACTIVE_DEADLINE_SECONDS,
} from "@shepherdjerred/homelab/cdk8s/src/temporal-release-budgets.ts";
import { createTemporalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/temporal.ts";

const ResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z
      .object({
        name: z.string(),
        namespace: z.string().optional(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .loose(),
    spec: z.unknown().optional(),
  })
  .loose();

const RbacRulesSchema = z.object({
  rules: z.array(
    z
      .object({
        apiGroups: z.array(z.string()),
        resources: z.array(z.string()),
        resourceNames: z.array(z.string()).optional(),
        verbs: z.array(z.string()),
      })
      .loose(),
  ),
});

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

// The preflight's RBAC reuses one name across three namespaces, so a
// kind-and-name lookup would silently assert against whichever came first.
function findNamespacedResource(kind: string, name: string, namespace: string) {
  const resource = resources().find(
    (candidate) =>
      candidate.kind === kind &&
      candidate.metadata.name === name &&
      candidate.metadata.namespace === namespace,
  );
  if (resource === undefined) {
    throw new Error(`Missing ${kind}/${name} in namespace ${namespace}`);
  }
  return resource;
}

function backupPreflightRules(namespace: string) {
  return RbacRulesSchema.parse(
    findNamespacedResource("Role", "temporal-backup-preflight", namespace),
  ).rules;
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
    // the Temporal PVC's own snapshot, not just any completed snapshot. The
    // per-PVC proof is the ZFSBackup object openebs zfs-localpv writes per
    // volume, keyed by the PVC's bound PV and the Velero backup name.
    expect(command).toContain("pgdata-temporal-postgresql-0");
    expect(command).toContain("velero.io/backup=enabled");
    expect(command).toContain("{.spec.volumeName}");
    expect(command).toContain(
      'zfsbackups.zfs.openebs.io "$temporal_pv_name.$backup_name"',
    );
    expect(command).toContain('volume_backup_status" != "Done');

    // Comparing the backup's snapshot count against the CURRENT number of
    // backup-enabled PVCs asserted that cluster inventory never changes
    // between a backup and a release, which is not an invariant: retiring or
    // adding any backup-enabled PVC anywhere failed every Temporal release
    // until the next backup ran. The ZFSBackup lookup above proves the same
    // thing directly, so that inference must not come back.
    expect(command).not.toContain("enabled_pvc_count");
    expect(command).not.toContain("--all-namespaces");
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

    // One Role per namespace that owns the objects the script reads: the Velero
    // Backup, this PVC, and its ZFSBackup each live somewhere different.
    for (const namespace of ["velero", "temporal", "openebs"]) {
      for (const kind of ["Role", "RoleBinding"]) {
        expect(
          findNamespacedResource(kind, "temporal-backup-preflight", namespace)
            .metadata.annotations,
        ).toMatchObject(rbacAnnotations);
      }
    }

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

  test("reads only the objects the backup preflight proof needs", () => {
    expect(backupPreflightRules("temporal")).toEqual([
      {
        apiGroups: [""],
        resources: ["persistentvolumeclaims"],
        resourceNames: ["pgdata-temporal-postgresql-0"],
        verbs: ["get"],
      },
    ]);
    expect(backupPreflightRules("openebs")).toEqual([
      {
        apiGroups: ["zfs.openebs.io"],
        resources: ["zfsbackups"],
        verbs: ["get"],
      },
    ]);

    // Listing every PVC in the cluster was only ever needed by the
    // inventory-count inference the ZFSBackup lookup replaced, so the hook must
    // no longer hold a cluster-scoped grant at all.
    expect(
      resources().filter(
        (resource) =>
          (resource.kind === "ClusterRole" ||
            resource.kind === "ClusterRoleBinding") &&
          resource.metadata.name.startsWith("temporal-backup-preflight"),
      ),
    ).toEqual([]);
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

    expect(container.image).toContain("temporalio/admin-tools:1.31.2@sha256:");
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

    expect(container.image).toContain("temporalio/server:1.31.2@sha256:");
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

describe("Temporal release budgets", () => {
  test("keeps the schema migration inside the release sync budget", () => {
    // The release waiter must outlast this hook. Raising the deadline without
    // raising the floor reintroduces the builds 16963/16977 failure, where CI
    // timed out a still-running migration and the next build replaced the
    // in-flight hook mid-DDL.
    expect(TEMPORAL_CHILD_SYNC_TIMEOUT_SECONDS).toBeGreaterThan(
      TEMPORAL_SCHEMA_MIGRATION_ACTIVE_DEADLINE_SECONDS,
    );
    const job = findResource("Job", "temporal-schema-migration");
    const spec = z
      .object({ activeDeadlineSeconds: z.number() })
      .loose()
      .parse(job.spec);
    expect(spec.activeDeadlineSeconds).toBe(
      TEMPORAL_SCHEMA_MIGRATION_ACTIVE_DEADLINE_SECONDS,
    );
  });
});
