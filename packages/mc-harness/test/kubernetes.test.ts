import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { SandboxCreateRequest } from "#protocol/ipc.ts";
import { BRIDGE_JAR } from "#protocol/paths.ts";
import {
  kubectlArgs,
  MC_HARNESS_SERVICE_ACCOUNT,
  type KubectlRunner,
} from "#providers/kubernetes/kubectl.ts";
import {
  activeDeadlineSeconds,
  buildSandboxPod,
  CI_NODE_TOLERATION,
  EXPIRES_AT_ANNOTATION,
  MANAGED_BY_LABEL,
  MAX_ACTIVE_DEADLINE_SECONDS,
  requireDigestPinned,
  SANDBOX_LABEL,
  sandboxPodName,
  type SandboxPod,
} from "#providers/kubernetes/pod-manifest.ts";
import {
  parseForwardedPorts,
  PortForward,
  portForwardArgs,
  type ForwardProcess,
  type ProcessSpawner,
} from "#providers/kubernetes/port-forward.ts";
import {
  podIsReapable,
  podIsServing,
  type ClusterPod,
} from "#providers/kubernetes/pod-state.ts";
import { KubernetesSandboxProvider } from "#providers/kubernetes/provider.ts";
import { SandboxProviders } from "#sandbox/backend.ts";
import { providerFor, resolveProfile } from "#sandbox/profiles.ts";
import type { SandboxProvider } from "#sandbox/provider.ts";
import {
  SandboxRecordSchema,
  SandboxStore,
  type SandboxRecord,
} from "#sandbox/record.ts";

const secrets = { bridgeToken: "b".repeat(48), rconPassword: "c".repeat(48) };
const target = {
  context: "admin@torvalds",
  namespace: "mc-sandbox",
  as: MC_HARNESS_SERVICE_ACCOUNT,
};

const SAMPLE_RECORD: SandboxRecord = {
  id: "sbx-000000",
  provider: "docker",
  profile: "paper",
  world: "flat",
  status: "ready",
  createdAt: "2026-10-03T00:00:00.000Z",
  expiresAt: "2026-10-03T02:00:00.000Z",
  keep: false,
  bootMs: 1,
  endpoints: {
    game: { host: "127.0.0.1", port: 1 },
    rcon: { host: "127.0.0.1", port: 2 },
    bridge: { host: "127.0.0.1", port: 3 },
  },
  providerRef: { kind: "docker", containerId: "abcdef0123456789" },
  owner: "me@host",
  secrets,
};

function pod(options: {
  ttlSeconds?: number;
  profile?: SandboxCreateRequest["profile"];
}) {
  const profileName = options.profile ?? "paper";
  return buildSandboxPod({
    id: "sbx-abc123",
    profileName,
    profile: resolveProfile({ profile: profileName, world: "flat" }, secrets),
    ttlSeconds: options.ttlSeconds ?? 7200,
    expiresAt: "2026-10-04T02:00:00.000Z",
    keep: false,
    owner: "me@host",
  });
}

function spec(manifest: SandboxPod): SandboxPod["spec"] {
  return manifest.spec;
}

/** Progress lines are not asserted. */
function quiet(): void {
  // Intentionally empty: tests assert on cluster calls, not progress text.
}

describe("kubectl argv", () => {
  it("always pins context, impersonation and namespace first", () => {
    expect(kubectlArgs(target, ["get", "pods"])).toEqual([
      "--context",
      "admin@torvalds",
      "--as=system:serviceaccount:mc-sandbox:mc-harness",
      "-n",
      "mc-sandbox",
      "get",
      "pods",
    ]);
  });
});

describe("sandbox pod manifest (mc-sandbox admission policy)", () => {
  it("carries the harness labels and TTL annotation", () => {
    const { metadata } = pod({});
    expect(metadata.name).toBe(sandboxPodName("sbx-abc123"));
    expect(metadata.labels[MANAGED_BY_LABEL]).toBe("mc-harness");
    expect(metadata.labels[SANDBOX_LABEL]).toBe("sbx-abc123");
    expect(metadata.annotations[EXPIRES_AT_ANNOTATION]).toBe(
      "2026-10-04T02:00:00.000Z",
    );
  });

  it("bounds the pod lifetime at TTL plus grace, never past 8 h", () => {
    expect(spec(pod({ ttlSeconds: 3600 })).activeDeadlineSeconds).toBe(4200);
    expect(activeDeadlineSeconds(MAX_ACTIVE_DEADLINE_SECONDS)).toBe(
      MAX_ACTIVE_DEADLINE_SECONDS,
    );
    expect(() => pod({ ttlSeconds: MAX_ACTIVE_DEADLINE_SECONDS + 1 })).toThrow(
      /at most 8 h/u,
    );
  });

  it("runs at batch-low priority on the CI node only", () => {
    const podSpec = spec(pod({}));
    expect(podSpec.priorityClassName).toBe("batch-low");
    expect(podSpec.nodeSelector).toEqual({
      "kubernetes.io/hostname": "liskov",
    });
    expect(podSpec.tolerations).toEqual([CI_NODE_TOLERATION]);
    expect(podSpec.automountServiceAccountToken).toBe(false);
  });

  it("bounds cpu, memory and ephemeral storage on every container", () => {
    const podSpec = spec(pod({}));
    const containers = [
      ...(podSpec.initContainers ?? []),
      ...podSpec.containers,
    ];
    expect(containers.map((container) => container.name)).toEqual([
      "stage",
      "minecraft",
    ]);
    for (const container of containers) {
      for (const resource of ["cpu", "memory", "ephemeral-storage"]) {
        expect(container.resources.requests[resource]).toBeDefined();
        expect(container.resources.limits[resource]).toBeDefined();
      }
    }
  });

  it("uses only emptyDir volumes", () => {
    for (const volume of spec(pod({})).volumes) {
      expect(Object.keys(volume).toSorted()).toEqual(["emptyDir", "name"]);
    }
  });

  it("meets Pod Security restricted", () => {
    const podSpec = spec(pod({}));
    expect(podSpec.securityContext).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 3000,
      fsGroup: 2000,
      seccompProfile: { type: "RuntimeDefault" },
    });
    for (const container of [
      ...(podSpec.initContainers ?? []),
      ...podSpec.containers,
    ]) {
      expect(container.securityContext).toMatchObject({
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        runAsNonRoot: true,
        capabilities: { drop: ["ALL"] },
        seccompProfile: { type: "RuntimeDefault" },
      });
    }
  });

  it("pins every image by digest and rejects tags", () => {
    for (const container of spec(pod({})).containers) {
      expect(container.image).toMatch(/@sha256:[0-9a-f]{64}$/u);
    }
    expect(() => requireDigestPinned("itzg/minecraft-server:latest")).toThrow(
      /digest/u,
    );
  });

  it("stages Paper plugins and the Storm image's module-config overlay", () => {
    const paper = spec(pod({}));
    expect(paper.containers[0]?.volumeMounts).toContainEqual({
      name: "staging",
      mountPath: "/plugins",
      subPath: "plugins",
      readOnly: true,
    });
    const storm = spec(pod({ profile: "storm-prod" }));
    expect(storm.initContainers).toHaveLength(1);
    expect(
      storm.containers[0]?.volumeMounts.map((mount) => mount.mountPath),
    ).toEqual([
      "/data",
      "/tmp",
      "/plugins/TheStorm/config.yml",
      "/plugins/TheStormFixtures.jar",
    ]);
    expect(storm.containers[0]?.volumeMounts).toContainEqual({
      name: "staging",
      mountPath: "/plugins/TheStorm/config.yml",
      subPath: "plugins/TheStorm/config.yml",
      readOnly: true,
    });
    expect(storm.containers[0]?.volumeMounts).toContainEqual({
      name: "staging",
      mountPath: "/plugins/TheStormFixtures.jar",
      subPath: "plugins/TheStormFixtures.jar",
      readOnly: true,
    });
    expect(storm.containers[0]?.image).toMatch(
      /^ghcr\.io\/shepherdjerred\/the-storm-server:.+@sha256:/u,
    );
  });
});

describe("profiles", () => {
  it("defaults storm images to the cluster and the rest to Docker", () => {
    const base = { world: "flat" as const };
    expect(providerFor({ ...base, profile: "paper" })).toBe("docker");
    expect(providerFor({ ...base, profile: "storm-dev" })).toBe("docker");
    expect(providerFor({ ...base, profile: "storm-prod" })).toBe("kubernetes");
    expect(providerFor({ ...base, profile: "storm-candidate" })).toBe(
      "kubernetes",
    );
    expect(
      providerFor({ ...base, profile: "paper", provider: "kubernetes" }),
    ).toBe("kubernetes");
  });

  it("boots the storm image with fixture credentials and world bootstrap", () => {
    const profile = resolveProfile(
      { profile: "storm-prod", world: "flat" },
      secrets,
    );
    expect(profile.seedData).toBe(false);
    expect(profile.plugins).toEqual([]);
    expect(profile.env).toMatchObject({
      ONLINE_MODE: "FALSE",
      CFG_PROXY_PROTOCOL: "false",
      MC_BRIDGE_TOKEN: secrets.bridgeToken,
      DISCORD_BOT_TOKEN: "invalid-storm-fixture-token",
      RWF_RECORDING_SALT: "storm-sandbox-recording-salt",
    });
  });
});

describe("port-forward", () => {
  it("parses the local port bound for each container port", () => {
    const ports = parseForwardedPorts(
      [
        "Forwarding from 127.0.0.1:41001 -> 25565",
        "Forwarding from [::1]:41001 -> 25565",
        "Forwarding from 127.0.0.1:41002 -> 25575",
        "Handling connection for 41001",
      ].join("\n"),
    );
    expect([...ports]).toEqual([
      [25_565, 41_001],
      [25_575, 41_002],
    ]);
    expect(portForwardArgs("mc-harness-sbx-abc123", [25_565, 25_580])).toEqual([
      "port-forward",
      "--address",
      "127.0.0.1",
      "pod/mc-harness-sbx-abc123",
      ":25565",
      ":25580",
    ]);
  });

  it("restarts after the forward exits and reports the new ports", async () => {
    const children: ReturnType<typeof fakeForward>[] = [];
    const spawn: ProcessSpawner = () => {
      const child = fakeForward(41_000 + children.length * 10);
      children.push(child);
      return child.process;
    };
    const restarts: Map<number, number>[] = [];
    const forward = new PortForward({
      argv: ["port-forward"],
      ports: [25_565],
      spawn,
      sleep: () => Promise.resolve(),
      onRestart: (ports) => restarts.push(ports),
    });
    const bound = await forward.start();
    expect(bound.get(25_565)).toBe(41_000);
    children[0]?.exit();
    await waitFor(() => restarts.length === 1);
    expect(restarts[0]?.get(25_565)).toBe(41_010);
    forward.stop();
    expect(children[1]?.killed()).toBe(true);
  });
});

function fakeForward(localBase: number): {
  process: ForwardProcess;
  exit: () => void;
  killed: () => boolean;
} {
  const exit = Promise.withResolvers<number>();
  let wasKilled = false;
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          [25_565, 25_575, 25_580]
            .map(
              (port, index) =>
                `Forwarding from 127.0.0.1:${(localBase + index).toString()} -> ${port.toString()}\n`,
            )
            .join(""),
        ),
      );
    },
  });
  return {
    process: {
      stdout,
      exited: exit.promise,
      kill: () => {
        wasKilled = true;
        exit.resolve(143);
      },
    },
    exit: () => {
      exit.resolve(1);
    },
    killed: () => wasKilled,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Bun.sleep(5);
  }
  throw new Error("condition never became true");
}

describe("records", () => {
  it("reads legacy Docker records as a Docker providerRef", () => {
    const { providerRef: _ref, ...rest } = SAMPLE_RECORD;
    const legacy = { ...rest, containerId: "abcdef0123456789" };
    const record = SandboxRecordSchema.parse(legacy);
    expect(record.providerRef).toEqual({
      kind: "docker",
      containerId: "abcdef0123456789",
    });
    expect("containerId" in record).toBe(false);
    expect(
      SandboxRecordSchema.safeParse({
        ...record,
        provider: "kubernetes",
      }).success,
    ).toBe(false);
  });
});

function clusterPod(options: {
  id: string;
  phase: string;
  ready?: boolean;
  expiresAt?: string;
  keep?: boolean;
  stageRunning?: boolean;
}): ClusterPod {
  return {
    metadata: {
      name: sandboxPodName(options.id),
      labels: { [MANAGED_BY_LABEL]: "mc-harness", [SANDBOX_LABEL]: options.id },
      annotations: {
        [EXPIRES_AT_ANNOTATION]:
          options.expiresAt ?? "2099-01-01T00:00:00.000Z",
        "mc-harness.sjer.red/keep": String(options.keep ?? false),
      },
    },
    status: {
      phase: options.phase,
      initContainerStatuses: [
        {
          name: "stage",
          state:
            options.stageRunning === true ? { running: {} } : { waiting: {} },
        },
      ],
      containerStatuses: [
        {
          name: "minecraft",
          ready: options.ready ?? false,
          state:
            options.phase === "Running" ? { running: {} } : { waiting: {} },
        },
      ],
    },
  };
}

describe("pod state", () => {
  it("serves only when running and ready", () => {
    expect(
      podIsServing(
        clusterPod({ id: "sbx-aaaaaa", phase: "Running", ready: true }),
      ),
    ).toBe(true);
    expect(
      podIsServing(clusterPod({ id: "sbx-aaaaaa", phase: "Running" })),
    ).toBe(false);
    expect(podIsServing(undefined)).toBe(false);
  });

  it("reaps expired unkept pods and finished pods", () => {
    const now = new Date("2026-10-04T00:00:00.000Z");
    const past = "2026-10-03T00:00:00.000Z";
    expect(
      podIsReapable(
        clusterPod({ id: "sbx-aaaaaa", phase: "Running", expiresAt: past }),
        now,
      ),
    ).toBe(true);
    expect(
      podIsReapable(
        clusterPod({
          id: "sbx-aaaaaa",
          phase: "Running",
          expiresAt: past,
          keep: true,
        }),
        now,
      ),
    ).toBe(false);
    expect(
      podIsReapable(clusterPod({ id: "sbx-aaaaaa", phase: "Failed" }), now),
    ).toBe(true);
    expect(
      podIsReapable(clusterPod({ id: "sbx-aaaaaa", phase: "Running" }), now),
    ).toBe(false);
  });
});

function ok(stdout = ""): { stdout: string; stderr: string } {
  return { stdout, stderr: "" };
}

const CreatedPodSchema = z.object({
  metadata: z.object({ labels: z.record(z.string(), z.string()) }),
});

/** A scripted cluster: answers kubectl calls from in-memory pod state. */
class FakeCluster {
  calls: string[][] = [];
  pods = new Map<string, ClusterPod>();
  readonly runner: KubectlRunner = (args, options) => {
    // Drop the --context/--as/-n prefix (asserted separately).
    expect(args.slice(0, 5)).toEqual(kubectlArgs(target, []));
    const rest = args.slice(5);
    this.calls.push(rest);
    return Promise.resolve(this.answer(rest, options?.stdin));
  };

  private answer(
    rest: readonly string[],
    stdin: string | undefined,
  ): { stdout: string; stderr: string } {
    const [verb, kind, name] = rest;
    if (verb === "auth") {
      return ok("yes\n");
    }
    if (verb === "create") {
      const manifest = CreatedPodSchema.parse(JSON.parse(stdin ?? "{}"));
      const id = manifest.metadata.labels[SANDBOX_LABEL] ?? "";
      this.pods.set(
        id,
        clusterPod({ id, phase: "Pending", stageRunning: true }),
      );
      return ok("pod created\n");
    }
    if (verb === "exec" && rest.includes("touch")) {
      // Staging done: the server starts.
      for (const [id] of this.pods) {
        this.pods.set(id, clusterPod({ id, phase: "Running", ready: true }));
      }
      return ok();
    }
    if (verb === "get" && kind === "pod") {
      const found = [...this.pods.values()].find(
        (candidate) => candidate.metadata.name === name,
      );
      return ok(JSON.stringify(found));
    }
    if (verb === "get" && kind === "pods") {
      return ok(JSON.stringify({ items: [...this.pods.values()] }));
    }
    if (verb === "logs") {
      return ok('[Server] Done (3.21s)! For help, type "help"\n');
    }
    if (verb === "delete") {
      const id = [...this.pods.entries()].find(
        ([, candidate]) => candidate.metadata.name === kind,
      )?.[0];
      if (id === undefined) {
        return ok();
      }
      this.pods.delete(id);
      return ok(`pod "${kind ?? ""}" deleted\n`);
    }
    return ok();
  }
}

describe("KubernetesSandboxProvider (scripted cluster)", () => {
  let root: string;
  let store: SandboxStore;
  let cluster: FakeCluster;
  let spawned: number;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "mc-k8s-"));
    store = new SandboxStore(path.join(root, "sandboxes"));
    cluster = new FakeCluster();
    spawned = 0;
    // The paper profile requires the built bridge jar in the repository.
    await mkdir(path.dirname(path.join(root, "repo", BRIDGE_JAR)), {
      recursive: true,
    });
    await Bun.write(path.join(root, "repo", BRIDGE_JAR), "jar");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function provider(): KubernetesSandboxProvider {
    return new KubernetesSandboxProvider({
      repoRoot: path.join(root, "repo"),
      store,
      target,
      cacheDir: path.join(root, "cache"),
      owner: "me@host",
      runner: cluster.runner,
      spawn: () => {
        spawned += 1;
        return fakeForward(42_000).process;
      },
      health: () => Promise.resolve(),
      pollMs: 1,
      stage: ({ dir }) =>
        Promise.resolve({
          pluginsDir: path.join(dir, "plugins"),
          seedFiles: [
            { source: path.join(dir, "bukkit.yml"), target: "bukkit.yml" },
          ],
        }),
    });
  }

  const request: SandboxCreateRequest = {
    profile: "paper",
    world: "flat",
    ttlSeconds: 3600,
    keep: false,
    provider: "kubernetes",
  };

  it("creates, stages, forwards and records a sandbox", async () => {
    const record = await provider().create(request, quiet);
    expect(record.provider).toBe("kubernetes");
    expect(record.providerRef).toMatchObject({
      kind: "kubernetes",
      context: "admin@torvalds",
      namespace: "mc-sandbox",
      pod: sandboxPodName(record.id),
    });
    expect(record.endpoints.bridge).toEqual({
      host: "127.0.0.1",
      port: 42_002,
    });
    const verbs = cluster.calls.map((call) => call.slice(0, 2).join(" "));
    expect(verbs).toContain("create -f");
    expect(verbs).toContain(`cp ${path.join(store.dir(record.id), "plugins")}`);
    expect(cluster.calls.at(-1)?.[0]).toBe("logs");
    expect(await store.read(record.id)).toMatchObject({ id: record.id });
  });

  it("rejects TTLs longer than the pod deadline", async () => {
    await expect(
      provider().create({ ...request, ttlSeconds: 9 * 3600 }, quiet),
    ).rejects.toThrow(/at most 8 h/u);
  });

  it("lists ready pods, re-attaching forwards after a restart", async () => {
    const created = await provider().create(request, quiet);
    const fresh = provider();
    const [listed] = await fresh.list();
    expect(listed).toMatchObject({ id: created.id, status: "ready" });
    expect(spawned).toBe(2);
  });

  it("reaps expired pods and drops records whose pod vanished", async () => {
    const first = await provider().create(request, quiet);
    const second = await provider().create(request, quiet);
    cluster.pods.set(
      first.id,
      clusterPod({
        id: first.id,
        phase: "Running",
        ready: true,
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    cluster.pods.delete(second.id);
    const reaped = await provider().reap(new Date());
    expect(reaped.toSorted()).toEqual([first.id, second.id].toSorted());
    expect(await store.listFor("kubernetes")).toEqual([]);
  });

  it("does not touch the cluster when it has no sandboxes there", async () => {
    expect(await provider().reap(new Date())).toEqual([]);
    expect(await provider().list()).toEqual([]);
    expect(cluster.calls).toEqual([]);
  });
});

function fakeProvider(kind: "docker" | "kubernetes") {
  const calls: string[] = [];
  const provider: SandboxProvider = {
    kind,
    preflight: () => {
      calls.push("preflight");
      return Promise.resolve();
    },
    create: (create) => {
      calls.push(`create:${create.profile}`);
      return Promise.resolve(SAMPLE_RECORD);
    },
    list: () => Promise.resolve([]),
    destroy: (id) => {
      calls.push(`destroy:${id}`);
      return Promise.resolve();
    },
    reap: () => Promise.resolve([]),
    logs: () => Promise.resolve([]),
  };
  return { provider, calls };
}

describe("SandboxProviders routing", () => {
  it("routes creates by profile default and preflights lazily", async () => {
    const docker = fakeProvider("docker");
    const kubernetes = fakeProvider("kubernetes");
    const root = await mkdtemp(path.join(os.tmpdir(), "mc-route-"));
    const backend = new SandboxProviders(
      { docker: docker.provider, kubernetes: kubernetes.provider },
      new SandboxStore(root),
    );
    await backend.preflight();
    const base = { world: "flat" as const, ttlSeconds: 600, keep: false };
    await backend.create({ ...base, profile: "paper" }, quiet);
    await backend.create({ ...base, profile: "storm-prod" }, quiet);
    await backend.create({ ...base, profile: "storm-prod" }, quiet);
    expect(docker.calls).toEqual(["preflight", "create:paper"]);
    expect(kubernetes.calls).toEqual([
      "preflight",
      "create:storm-prod",
      "create:storm-prod",
    ]);
    await backend.destroy("sbx-ffffff");
    expect(docker.calls.at(-1)).toBe("destroy:sbx-ffffff");
    await rm(root, { recursive: true, force: true });
  });
});
