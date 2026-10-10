/**
 * The live minecraft-tsmc target. Reaches MCBridge on the server pod through
 * a supervised `kubectl port-forward` as the scoped mc-harness ServiceAccount,
 * refuses while the server is asleep or held by the mining reset, and runs
 * every write through the guard: reason, players, backups, a snapshot first
 * for block writes, and one journal line per write.
 *
 * The bridge token comes only from the daemon's MC_BRIDGE_TOKEN environment
 * variable; it is never logged, journaled or returned.
 */
import { BridgeClient, type BridgeEndpoint } from "#bridge/client.ts";
import type { Box, Player } from "#protocol/bridge.ts";
import {
  LIVE_DAEMON_START_HINT,
  LIVE_TARGET_ID,
  type LiveBackupResponse,
  type LiveJournalEntry,
  type LiveStatusResponse,
  type LiveWriteFlags,
} from "#protocol/live.ts";
import type { Kubectl } from "#providers/kubernetes/kubectl.ts";
import {
  PortForward,
  type ProcessSpawner,
  portForwardArgs,
} from "#providers/kubernetes/port-forward.ts";
import {
  type DataFiles,
  ExecDataFiles,
  kubectlExecArgv,
  type Spawn,
} from "#src/files/data-files.ts";
import type { Target } from "#src/target.ts";
import { LiveBackups } from "./backup.ts";
import {
  type LiveGuardConfig,
  type LiveWriteOp,
  assessLiveWrite,
  authorizeLiveWrite,
} from "./guard.ts";
import { LiveJournal, newLiveJournalId, undoBlocker } from "./journal.ts";
import {
  LIVE_BRIDGE_PORT,
  LIVE_CONTAINER,
  LIVE_POD,
  type LiveClusterStatus,
  liveRefusal,
  readLiveStatus,
  restorationRefusal,
} from "./status.ts";

/** A refusal the daemon reports as a client error with this status. */
export class LiveError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "LiveError";
  }
}

export type LiveServiceOptions = {
  /** kubectl for minecraft-tsmc as the mc-harness ServiceAccount. */
  kubectl: Kubectl;
  /** kubectl for the velero namespace as the same ServiceAccount. */
  velero: Kubectl;
  token: () => string | undefined;
  config: () => Promise<LiveGuardConfig>;
  journal?: LiveJournal;
  spawn?: ProcessSpawner;
  now?: () => Date;
  log: (message: string, extra?: Record<string, unknown>) => void;
  /** Cluster status is re-read after this long for reads (writes always re-read). */
  statusTtlMs?: number;
  /** Builds the bridge client for the forwarded port (tests inject a fake). */
  bridge?: (endpoint: BridgeEndpoint) => BridgeClient;
  /** Spawns the `kubectl exec` reads behind `files()` (tests inject a fake). */
  execSpawn?: Spawn;
};

const LOG_EVENT_LIMIT = 2000;
const LOG_EVENT_PAGE_LIMIT = 500;

export class LiveService {
  private forward: PortForward | null = null;
  private port: number | null = null;
  private status: { value: LiveClusterStatus; at: number } | null = null;
  private readonly journal: LiveJournal;
  private readonly backups: LiveBackups;
  private readonly now: () => Date;

  constructor(private readonly options: LiveServiceOptions) {
    this.journal = options.journal ?? new LiveJournal();
    this.backups = new LiveBackups(options.velero);
    this.now = options.now ?? (() => new Date());
  }

  private async clusterStatus(fresh: boolean): Promise<LiveClusterStatus> {
    const ttl = this.options.statusTtlMs ?? 15_000;
    if (!fresh && this.status !== null && Date.now() - this.status.at < ttl) {
      return this.status.value;
    }
    const value = await readLiveStatus(this.options.kubectl);
    this.status = { value, at: Date.now() };
    return value;
  }

  private requireToken(): string {
    const token = this.options.token();
    if (token === undefined || token.length < 32) {
      throw new LiveError(
        `the daemon has no MCBridge token for live tsmc. Stop it (toolkit mc daemon stop) and start it with: ${LIVE_DAEMON_START_HINT}`,
        412,
      );
    }
    return token;
  }

  async describe(): Promise<LiveStatusResponse> {
    const status = await this.clusterStatus(true);
    return {
      ...status,
      tokenConfigured: (this.options.token()?.length ?? 0) >= 32,
      bridge: {
        connected: this.forward?.active === true && this.port !== null,
        localPort: this.port,
      },
      refusal: liveRefusal(status),
    };
  }

  private async ensureUsable(fresh: boolean): Promise<void> {
    const refusal = liveRefusal(await this.clusterStatus(fresh));
    if (refusal !== null) {
      this.stop();
      throw new LiveError(refusal);
    }
  }

  private client(token: string): BridgeClient {
    if (this.port === null) {
      throw new LiveError("the live bridge port-forward is not running", 503);
    }
    const endpoint = {
      baseUrl: `http://127.0.0.1:${this.port.toString()}`,
      token,
    };
    return this.options.bridge?.(endpoint) ?? new BridgeClient(endpoint);
  }

  private async connect(token: string): Promise<void> {
    if (this.forward?.active === true && this.port !== null) {
      return;
    }
    this.stop();
    const forward = new PortForward({
      argv: this.options.kubectl.argv(
        portForwardArgs(LIVE_POD, [LIVE_BRIDGE_PORT]),
      ),
      ports: [LIVE_BRIDGE_PORT],
      ...(this.options.spawn === undefined
        ? {}
        : { spawn: this.options.spawn }),
      onRestart: (ports) => {
        this.port = ports.get(LIVE_BRIDGE_PORT) ?? null;
        this.options.log("live port-forward restarted", { port: this.port });
      },
      onError: (error) => {
        this.options.log("live port-forward restart failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    const ports = await forward.start();
    this.forward = forward;
    this.port = ports.get(LIVE_BRIDGE_PORT) ?? null;
    try {
      await this.client(token).health();
    } catch (error) {
      this.stop();
      throw new LiveError(
        `MCBridge on ${LIVE_POD} did not answer (${error instanceof Error ? error.message : String(error)}). Is the image with MCBridge deployed, and does MC_BRIDGE_TOKEN match the storm-brain 1Password item?`,
        502,
      );
    }
    this.options.log("live bridge connected", { port: this.port });
  }

  /** The live target for one request (reads); refuses when asleep or locked. */
  async target(fresh = false): Promise<Target> {
    const token = this.requireToken();
    await this.ensureUsable(fresh);
    await this.connect(token);
    const bridge = this.client(token);
    return {
      id: LIVE_TARGET_ID,
      kind: "live",
      bridge,
      logs: {
        // The bridge captures server log lines; the scoped ServiceAccount
        // deliberately has no pods/log on tsmc.
        tail: async (lines) => {
          const events = [];
          let since = 0;
          for (
            let page = 0;
            page < LOG_EVENT_LIMIT / LOG_EVENT_PAGE_LIMIT;
            page++
          ) {
            const response = await bridge.events(since, LOG_EVENT_PAGE_LIMIT);
            events.push(...response.events);
            if (response.events.length < LOG_EVENT_PAGE_LIMIT) {
              break;
            }
            since = response.cursor;
          }
          return events
            .filter((event) => event.type === "log")
            .slice(-lines)
            .map((event) => event.text);
        },
      },
    };
  }

  /**
   * tsmc's /data for read-only pulls. Needs a running pod but no bridge
   * token; restoration leases block reads, but the mining-reset lock does not.
   */
  async files(): Promise<DataFiles> {
    const status = await this.clusterStatus(true);
    const restoration = restorationRefusal(status);
    if (restoration !== null) {
      throw new LiveError(restoration);
    }
    if (!status.podReady) {
      throw new LiveError(
        `live tsmc has no ready pod (phase ${status.podPhase ?? "none"}); it is probably asleep`,
      );
    }
    const { kubectl, execSpawn } = this.options;
    return new ExecDataFiles(
      (command) => kubectlExecArgv(kubectl, LIVE_POD, LIVE_CONTAINER, command),
      execSpawn,
    );
  }

  stop(): void {
    this.forward?.stop();
    this.forward = null;
    this.port = null;
  }

  private async entry(
    fields: Omit<LiveJournalEntry, "version" | "id" | "ts">,
  ): Promise<LiveJournalEntry> {
    const now = this.now();
    const entry: LiveJournalEntry = {
      version: 1,
      id: newLiveJournalId(now),
      ts: now.toISOString(),
      ...fields,
    };
    await this.journal.append(entry);
    return entry;
  }

  private async players(target: Target): Promise<Player[]> {
    const { players } = await target.bridge.players();
    return players;
  }

  /**
   * Runs one guarded live write. Reads (`list`, `data get`, ...) pass
   * straight through; writes are authorized, snapshotted (block writes) and
   * journaled whether they succeed or fail.
   */
  async write<T>(
    op: LiveWriteOp,
    flags: LiveWriteFlags,
    run: (target: Target) => Promise<T>,
  ): Promise<T> {
    const config = await this.options.config();
    const assessment = assessLiveWrite(op, config, flags.affects);
    if (assessment.read) {
      return run(await this.target());
    }
    // Writes always re-read the cluster: the mining reset may have locked it.
    const target = await this.target(true);
    const players = await this.players(target);
    const latest = assessment.tier === 2 ? await this.backups.latest() : null;
    const authorization = authorizeLiveWrite({
      assessment,
      flags,
      players,
      latestBackupAt: latest?.completedAt ?? null,
      now: this.now(),
      config,
    });
    const snapshotId =
      assessment.box === null
        ? null
        : await this.snapshot(target, assessment.box);
    const base = {
      kind: "write" as const,
      reason: authorization.reason,
      op: { kind: op.kind, summary: assessment.summary },
      tier: assessment.tier,
      world: assessment.world,
      box: assessment.box,
      humansOnline: authorization.humansOnline,
      backup:
        latest === null
          ? null
          : {
              name: latest.name,
              completedAt: latest.completedAt.toISOString(),
            },
      snapshotId,
      undoes: null,
    };
    try {
      const result = await run(target);
      const entry = await this.entry({ ...base, result: "ok", error: null });
      this.options.log("live write", {
        id: entry.id,
        op: op.kind,
        tier: assessment.tier,
      });
      return result;
    } catch (error) {
      await this.entry({
        ...base,
        result: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async snapshot(target: Target, box: Box): Promise<string> {
    const snapshot = await target.bridge.snapshotCreate(box, "live-undo");
    return snapshot.id;
  }

  async backup(reason: string, wait: boolean): Promise<LiveBackupResponse> {
    const name = await this.backups.create(this.now());
    let completedAt: Date | null = null;
    let phase = "New";
    if (wait) {
      completedAt = await this.backups.wait(name);
      phase = "Completed";
    }
    const entry = await this.entry({
      kind: "backup",
      reason,
      op: { kind: "backup", summary: `Velero backup ${name}` },
      tier: 0,
      world: null,
      box: null,
      humansOnline: [],
      backup:
        completedAt === null
          ? null
          : { name, completedAt: completedAt.toISOString() },
      snapshotId: null,
      result: "ok",
      error: null,
      undoes: null,
    });
    return {
      name,
      phase,
      completedAt: completedAt?.toISOString() ?? null,
      journalId: entry.id,
    };
  }

  async journalEntries(since?: Date): Promise<LiveJournalEntry[]> {
    return this.journal.list(since);
  }

  /**
   * Restores the snapshot taken before `id`, last-in-first-out. The restore
   * passes the same player and reason checks as any block write.
   */
  async undo(
    id: string,
    flags: LiveWriteFlags,
  ): Promise<{ entry: LiveJournalEntry; changed: number }> {
    const entries = await this.journal.list();
    const write = entries.find((entry) => entry.id === id);
    if (write === undefined) {
      throw new LiveError(`No live journal entry ${id}`, 404);
    }
    const blocker = undoBlocker(entries, write);
    if (blocker !== null || write.snapshotId === null || write.box === null) {
      throw new LiveError(blocker ?? `${id} has no snapshot to restore`);
    }
    const snapshotId = write.snapshotId;
    // Restoring what was there never needs a fresh backup, so no restorable
    // box is large enough for tier 2.
    const configured = await this.options.config();
    const config = {
      ...configured,
      maxRegionVolume: configured.maxSnapshotVolume,
    };
    const assessment = assessLiveWrite(
      { kind: "snapshot-restore", snapshotId, box: write.box },
      config,
    );
    const target = await this.target(true);
    const authorization = authorizeLiveWrite({
      assessment,
      flags,
      players: await this.players(target),
      latestBackupAt: null,
      now: this.now(),
      config,
    });
    const base = {
      kind: "undo" as const,
      reason: authorization.reason,
      op: {
        kind: "undo",
        summary: `restore snapshot ${snapshotId} (undo ${id})`,
      },
      tier: write.tier,
      world: write.world,
      box: write.box,
      humansOnline: authorization.humansOnline,
      backup: null,
      snapshotId: null,
      undoes: id,
    };
    try {
      const { changed } = await target.bridge.snapshotRestore(snapshotId);
      const entry = await this.entry({ ...base, result: "ok", error: null });
      return { entry, changed };
    } catch (error) {
      await this.entry({
        ...base,
        result: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
