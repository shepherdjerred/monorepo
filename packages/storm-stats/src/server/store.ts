import { Database } from "bun:sqlite";
import type {
  IngestBatch,
  IngestBatchAck,
  OnlineActivityResponse,
  PlayersDirectoryResponse,
  ServerOverviewResponse,
  ViewerRole,
} from "@shepherdjerred/storm-stats/shared/contract.ts";
import type {
  GameplayOverviewResponse,
  PvpOverviewResponse,
} from "@shepherdjerred/storm-stats/shared/gameplay-contract.ts";
import type { PlayerProfileResponse } from "@shepherdjerred/storm-stats/shared/player-contract.ts";
import type {
  StaffBouncesResponse,
  StaffNetworkResponse,
  StaffPlayerOverlayResponse,
  StaffQueryResponse,
} from "@shepherdjerred/storm-stats/shared/staff-contract.ts";
import { ingestBatchInTransaction } from "./ingest.ts";
import { loadServerState } from "./player-activity.ts";
import { queryOnlineActivity } from "./queries-activity.ts";
import {
  queryGameplayOverview,
  queryPvpOverview,
} from "./queries-combat-gameplay.ts";
import { queryServerOverview } from "./queries-overview.ts";
import {
  queryPlayerProfile,
  queryPlayersDirectory,
  type PlayersQueryOptions,
} from "./queries-players.ts";
import type { StaffQueryFilters } from "./queries-staff-filters.ts";
import {
  queryStaffBounces,
  queryStaffNetwork,
  queryStaffPlayerOverlay,
  queryStaffPlayerRaw,
  queryStaffSegment,
} from "./queries-staff.ts";
import { initializeSchema } from "./schema.ts";

function resolveNowIso(now?: Date | string): string {
  if (now === undefined) {
    return new Date().toISOString();
  }
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

export class StormStatsStore {
  readonly #db: Database;
  #closed = false;

  private constructor(db: Database) {
    this.#db = db;
    initializeSchema(this.#db);
  }

  static open(databasePath = ":memory:"): StormStatsStore {
    const db = new Database(databasePath, { create: true });
    return new StormStatsStore(db);
  }

  ping(): boolean {
    if (this.#closed) {
      return false;
    }
    try {
      const row = this.#db.query<{ ok: number }, []>("SELECT 1 AS ok").get();
      return row?.ok === 1;
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#db.close(false);
  }

  playerCount(): number {
    return (
      this.#db
        .query<{ c: number }, []>("SELECT COUNT(*) AS c FROM players")
        .get()?.c ?? 0
    );
  }

  onlineCount(now?: Date | string): number {
    return loadServerState(this.#db, resolveNowIso(now)).onlinePlayers.length;
  }

  serverName(): string {
    return loadServerState(this.#db).row.server_name;
  }

  ingestBatch(batch: IngestBatch): IngestBatchAck {
    return ingestBatchInTransaction(this.#db, batch);
  }

  getOverview(now?: Date | string): ServerOverviewResponse {
    return queryServerOverview(this.#db, resolveNowIso(now));
  }

  getActivity(now?: Date | string): OnlineActivityResponse {
    return queryOnlineActivity(this.#db, resolveNowIso(now));
  }

  getPlayers(
    options: PlayersQueryOptions,
    viewer: ViewerRole,
    now?: Date | string,
  ): PlayersDirectoryResponse {
    return queryPlayersDirectory(this.#db, options, viewer, resolveNowIso(now));
  }

  getPlayerProfile(
    idOrName: string,
    now?: Date | string,
  ): PlayerProfileResponse | null {
    return queryPlayerProfile(this.#db, idOrName, resolveNowIso(now));
  }

  getPvpOverview(now?: Date | string): PvpOverviewResponse {
    return queryPvpOverview(this.#db, resolveNowIso(now));
  }

  getGameplayOverview(now?: Date | string): GameplayOverviewResponse {
    return queryGameplayOverview(this.#db, resolveNowIso(now));
  }

  getStaffNetwork(now?: Date | string): StaffNetworkResponse {
    return queryStaffNetwork(this.#db, resolveNowIso(now));
  }

  getStaffBounces(now?: Date | string): StaffBouncesResponse {
    return queryStaffBounces(this.#db, resolveNowIso(now));
  }

  getStaffQuery(
    filters: StaffQueryFilters,
    now?: Date | string,
  ): StaffQueryResponse {
    return queryStaffSegment(this.#db, filters, resolveNowIso(now));
  }

  getStaffPlayerOverlay(
    idOrName: string,
    now?: Date | string,
  ): StaffPlayerOverlayResponse | null {
    return queryStaffPlayerOverlay(this.#db, idOrName, resolveNowIso(now));
  }

  getStaffPlayerRaw(
    idOrName: string,
    now?: Date | string,
  ): Record<string, unknown> | null {
    return queryStaffPlayerRaw(this.#db, idOrName, resolveNowIso(now));
  }
}
