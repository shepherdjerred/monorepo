import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type IPersistentVolumeClaim,
  Protocol,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import {
  applyZfsVolumeSelinuxRelabeling,
  type ZfsVolumeSelinuxLevel,
} from "@shepherdjerred/homelab/cdk8s/src/misc/selinux.ts";
import { ARGOCD_SYNC_WAVE_ANNOTATION } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { postgresImageDigests } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { scoutImageUsesPostgres } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import { scoutRuntimeProbes } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/probes.ts";

/** Pod label every gateway-role resource selects on. */
export const SCOUT_GATEWAY_APP_LABEL = "scout-gateway";

/**
 * The stages a human has opted into the split topology.
 *
 * Deliberately an explicit list rather than a predicate over the pins. Topology
 * must never appear as a side effect of a version bump: a stage joins the split
 * because someone added it here, and {@link assertStageCanHostSplitRoles} then
 * proves that stage is actually safe to split. The predicate gates a human
 * decision; it does not make one.
 */
export const SPLIT_TOPOLOGY_STAGES: readonly Stage[] = ["beta"];

/**
 * Refuse to synth a split-role stage whose image still keeps its database on
 * the shared volume.
 *
 * A pre-PostgreSQL Scout image runs `DATABASE_URL=file:/data/db.sqlite`, which
 * puts that stage's live database on the same ReadWriteOnce claim the report
 * lake uses. A second pod there means two processes holding one SQLite database
 * file open, so the co-mount this split depends on is only sound once the
 * stage's database has moved to PostgreSQL.
 *
 * Throwing at synth time is the point: a stage added to
 * {@link SPLIT_TOPOLOGY_STAGES} before its pin crosses over fails the build
 * rather than reaching a cluster.
 */
export function assertStageCanHostSplitRoles(
  stage: Stage,
  imageVersion: string,
): void {
  if (scoutImageUsesPostgres(imageVersion, postgresImageDigests)) return;
  throw new Error(
    `Scout ${stage} cannot host split runtime roles: its pinned image ${imageVersion} stores the database as SQLite at /data/db.sqlite on the same ReadWriteOnce claim as the report lake, so the split's second pod would hold that SQLite database file open concurrently. ` +
      `If you are adding ${stage} to SPLIT_TOPOLOGY_STAGES, promote it to a PostgreSQL-contract image first. ` +
      `If you are rolling ${stage}'s pin back past the PostgreSQL boundary, remove ${stage} from SPLIT_TOPOLOGY_STAGES in the same change — the rollback is only safe once the stage is back on the single combined pod.`,
  );
}

/**
 * The role label, so a metrics series or a NetworkPolicy can name the runtime
 * role rather than re-deriving it from the workload name. The value is the
 * `SCOUT_RUNTIME_ROLE` string from the backend's capability table, not a
 * homelab-local synonym.
 */
export const SCOUT_RUNTIME_ROLE_LABEL = "scout-runtime-role";

export type ScoutGatewayDeploymentOptions = {
  readonly imageVersion: string;
  /**
   * The application role's environment, verbatim.
   *
   * Deliberately not trimmed per role. `backend/src/configuration.ts` parses
   * env at module scope with no role awareness — `DISCORD_TOKEN` and
   * `RIOT_API_KEY` are both `getRequiredEnvVar`, so a gateway pod handed only
   * "the credentials the gateway uses" would fail config parsing before any
   * role logic ran. Scoping credentials per role is a backend change, not a
   * manifest change.
   */
  readonly envVariables: Record<string, EnvValue>;
  /**
   * The application role's report-lake claim. Mounted read-only here — see
   * {@link createScoutGatewayDeployment}.
   */
  readonly claim: IPersistentVolumeClaim;
  readonly selinuxLevel: ZfsVolumeSelinuxLevel;
  /**
   * The application role's Deployment, which this pod is required to schedule
   * onto the same node as. See {@link createScoutGatewayDeployment}.
   */
  readonly colocateWith: Deployment;
  /**
   * Hey Scout's OpenAI credential mount, when the stage has one.
   *
   * Voice belongs to this role: the capability table gives `voiceAssistant` and
   * `voiceStateAccess` to `combined` and `gateway` only, because the subsystem
   * reads an active voice connection's audio. This is the pod that runs
   * `/scout join`, so it is the pod that needs the credential — carrying it on
   * the application pod instead would leave `OPENAI_API_KEY_FILE` pointing at a
   * path that does not exist here.
   */
  readonly voiceSecretMount?: {
    readonly path: string;
    readonly volume: Volume;
  };
};

/**
 * The `gateway` runtime role: the Discord shard, its commands and guild
 * lifecycle, and the Hey Scout voice assistant.
 *
 * ## Why this mounts the report lake, read-only
 *
 * The capability table gives `gateway` `reportLakeAccess: true`. That is not
 * incidental: `/scout ask` and the Dare commands run the Explore agent in the
 * process that received the interaction, which is a synchronous DuckDB read on
 * this pod. `runtime/plan.ts` therefore puts the `report-lake` boot step in
 * this role's plan, and because the role does not fold, `runtime/subsystems.ts`
 * resolves it to `assertPublishedReportLake({ onUnpublished: "refuse" })` — an
 * unmounted lake is a refusal to start, not a degraded mode. A gateway
 * Deployment without this volume is a crash loop.
 *
 * Sharing the volume is sound specifically because of what this role does NOT
 * do. It runs no Temporal worker (`temporalWorkers` and
 * `deferredTemporalWorkers` are both empty) and does not fold, so it never
 * writes a staging directory and never moves the `CURRENT` pointer. That
 * leaves exactly one publisher — the `application` role — and N readers, which
 * is what an atomic build-pointer layout is for. `readOnly` is the enforcement
 * rather than the assumption.
 *
 * Mounting it `readOnly` is verified, not assumed. The role's two lake paths
 * are the boot gate (`report-lake/paths.ts#readCurrentBuildDir` — a pointer
 * read, a `readdir`, no writes) and Explore queries
 * (`reports/duckdb/lake.ts`, which only builds `read_parquet` sources against
 * an in-memory DuckDB instance). The only function in that module that creates
 * anything, `ensureLakeScaffold`, is reached solely from `report-lake/
 * compactor.ts` (the fold) and `report-lake/staging.ts` (ingest) — the two
 * paths this role does not run.
 *
 * `activity-worker` is NOT safe on the same terms and is deliberately absent
 * rather than scaffolded. The backend README states its precondition: "So
 * `activity-worker` needs the same volume `application` owns, and the cluster
 * PVC is ReadWriteOnce — the two roles cannot both mount it as things stand.
 * Splitting them needs the lake to become shareable (a remote store, or every
 * reader moved behind the `lake` queue) first." Until one of those lands there
 * is nothing to render, so nothing here renders it.
 *
 * ## Why it is required onto the application pod's node
 *
 * ReadWriteOnce is a per-NODE constraint, not a per-pod one: pods co-located on
 * one node may share the claim, pods on different nodes may not. The taint on
 * `liskov` happens to force both pods onto `torvalds` today, but that is the
 * cluster being single-node for this workload, not a guarantee. A required
 * podAffinity onto the application Deployment makes the co-location the
 * scheduler's constraint, so the pair cannot be silently split apart by a
 * future node — the gateway stays Pending instead of failing to mount.
 */
export function createScoutGatewayDeployment(
  chart: Chart,
  stage: Stage,
  options: ScoutGatewayDeploymentOptions,
) {
  const deployment = new Deployment(chart, "scout-gateway", {
    replicas: 1,
    // One Discord identity per token. Recreate keeps the old shard fully
    // terminated before the replacement logs in; a rolling update would put
    // two sessions on one token.
    strategy: DeploymentStrategy.recreate(),
    progressDeadline: Duration.seconds(2400),
    terminationGracePeriod: Duration.seconds(45),
    securityContext: {},
    podMetadata: {
      labels: {
        app: SCOUT_GATEWAY_APP_LABEL,
        [SCOUT_RUNTIME_ROLE_LABEL]: "gateway",
      },
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "Scout requires flexible user permissions",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Scout requires a writable filesystem for its runtime scratch space",
        // One Discord identity, enforced by the sync rather than by an operator
        // running the cutover in the right order.
        //
        // scout-beta auto-syncs, so on the sync that introduces the split
        // ArgoCD would otherwise be free to create this pod while the old
        // combined pod still holds the shard — two sessions on one token, which
        // Discord resolves by dropping one and which reads as a flapping bot.
        // Everything else in this chart sits in the default wave 0, including
        // the backend Deployment whose Recreate rollout terminates the combined
        // pod and brings up the `application` pod. ArgoCD starts a wave only
        // once every resource in the previous wave reports Healthy, so putting
        // this Deployment in wave 1 makes "the shard has been handed over" a
        // precondition of it existing at all.
        //
        // The gateway's Service, ServiceMonitor and NetworkPolicy deliberately
        // stay in wave 0: the policy governing this pod should exist before the
        // pod does.
        [ARGOCD_SYNC_WAVE_ANNOTATION]: "1",
      },
    },
  });

  // Required (not preferred) podAffinity on the hostname topology: the shared
  // ReadWriteOnce claim is only mountable by both pods while they are on one
  // node.
  deployment.scheduling.colocate(options.colocateWith);

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/scout-for-lol:${options.imageVersion}`,
      ports: [
        {
          name: "port-3000",
          number: 3000,
          protocol: Protocol.TCP,
        },
      ],
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      // No Temporal activity workers, no lake fold and no report rendering,
      // but this is the pod that loads the Hey Scout voice runtime (three
      // sherpa int8 graphs, silero VAD and the openWakeWord cascade) and runs
      // in-process Explore queries. #2870 sized beta at 3Gi for that runtime
      // "on top of the report lake"; after the split those two loads sit in
      // different pods, so the voice share lands here. Re-tune from observed
      // usage under a live voice session rather than guessing again.
      resources: {
        cpu: { request: Cpu.millis(50) },
        memory: { request: Size.gibibytes(2) },
      },
      // Identical probe paths to the application role. `httpSurface: "admin"`
      // serves /ping, /livez, /healthz and /metrics on the same port 3000 as
      // the full server (backend src/http/admin-server.ts) — the surface that
      // is missing here is the product's, not the operator's.
      ...scoutRuntimeProbes(),
      volumeMounts: [
        {
          path: "/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "scout-gateway-volume",
            options.claim,
            { readOnly: true },
          ),
        },
        ...(options.voiceSecretMount === undefined
          ? []
          : [options.voiceSecretMount]),
      ],
      envVariables: {
        ...options.envVariables,
        SCOUT_RUNTIME_ROLE: EnvValue.fromValue("gateway"),
      },
    }),
  );

  // Must match the application pod's level exactly: the MCS categories are how
  // the shared ZFS volume's files are labelled, so a different level here
  // would relabel the lake out from under the publisher.
  applyZfsVolumeSelinuxRelabeling(deployment, options.selinuxLevel);

  setRevisionHistoryLimit(deployment);

  new Service(chart, `scout-gateway-service-${stage}`, {
    metadata: {
      name: `scout-gateway-service-${stage}`,
      labels: {
        app: SCOUT_GATEWAY_APP_LABEL,
        stage,
      },
    },
    selector: deployment,
    ports: [{ name: "metrics", port: 3000 }],
  });

  createServiceMonitor(chart, {
    name: `scout-gateway-${stage}`,
    matchLabels: { app: SCOUT_GATEWAY_APP_LABEL, stage },
  });

  return deployment;
}
