import type { AppConfig } from "./config.ts";
import {
  collectPetCare,
  createPetCareClients,
  type PetCareClients,
  type PetCareCollection,
} from "./collectors/pets.ts";
import type { PetCarePayload } from "./types.ts";

const CACHE_DURATION_MS = 20_000;

export class PetCareService {
  private readonly config: AppConfig;
  private readonly clients: PetCareClients;
  private cached: { expiresAt: number; value: PetCareCollection } | undefined;
  private pending: Promise<PetCareCollection> | undefined;

  public constructor(
    config: AppConfig,
    clients = createPetCareClients(config),
  ) {
    this.config = config;
    this.clients = clients;
  }

  public async getPayload(): Promise<PetCarePayload> {
    const collection = await this.getCollection();
    return collection.payload;
  }

  public async getMetrics(): Promise<string> {
    return renderPetCareMetrics(await this.getCollection());
  }

  private async getCollection(): Promise<PetCareCollection> {
    const now = Date.now();
    if (this.cached !== undefined && this.cached.expiresAt > now) {
      return this.cached.value;
    }
    if (this.pending !== undefined) {
      return this.pending;
    }
    const pending = collectPetCare(this.config, this.clients);
    this.pending = pending;
    try {
      const value = await pending;
      this.cached = { expiresAt: now + CACHE_DURATION_MS, value };
      return value;
    } finally {
      this.pending = undefined;
    }
  }
}

export function renderPetCareMetrics(collection: PetCareCollection): string {
  const lines = [
    "# HELP trmnl_petcare_source_up Whether a pet-care source was read successfully.",
    "# TYPE trmnl_petcare_source_up gauge",
    metric(
      "trmnl_petcare_source_up",
      bool(collection.metrics.sourceUp.homeAssistant),
      { source: "home_assistant" },
    ),
    metric(
      "trmnl_petcare_source_up",
      bool(collection.metrics.sourceUp.whisker),
      { source: "whisker" },
    ),
    metric(
      "trmnl_petcare_source_up",
      bool(collection.metrics.sourceUp.alerts),
      { source: "alertmanager" },
    ),
  ];
  const robot = collection.metrics.litterRobot;
  if (robot !== null) {
    lines.push(
      "# HELP trmnl_petcare_litter_percent Fresh LR5 globe litter percentage.",
      "# TYPE trmnl_petcare_litter_percent gauge",
      metric("trmnl_petcare_litter_percent", robot.litterPercent),
      "# HELP trmnl_petcare_litter_waste_percent Fresh LR5 waste drawer percentage.",
      "# TYPE trmnl_petcare_litter_waste_percent gauge",
      metric("trmnl_petcare_litter_waste_percent", robot.wastePercent),
      "# HELP trmnl_petcare_litter_hopper_status Fresh LR5 hopper categorical state.",
      "# TYPE trmnl_petcare_litter_hopper_status gauge",
      metric("trmnl_petcare_litter_hopper_status", 1, {
        status: robot.hopperHealth,
      }),
      metric("trmnl_petcare_litter_online", bool(robot.online)),
      metric("trmnl_petcare_litter_ready", bool(robot.ready)),
      metric("trmnl_petcare_litter_source_fresh", bool(robot.sourceFresh)),
      metric("trmnl_petcare_litter_fault", bool(robot.faulted)),
      metric(
        "trmnl_petcare_litter_hopper_installed",
        bool(robot.hopperInstalled),
      ),
      metric("trmnl_petcare_litter_hopper_enabled", bool(robot.hopperEnabled)),
    );
    if (robot.hopperLevelRaw !== null) {
      lines.push(
        "# HELP trmnl_petcare_litter_hopper_level_raw Raw Whisker hopper-level indicator; its scale is not established.",
        "# TYPE trmnl_petcare_litter_hopper_level_raw gauge",
        metric("trmnl_petcare_litter_hopper_level_raw", robot.hopperLevelRaw),
      );
    }
    if (robot.filterDueAt !== null) {
      lines.push(
        "# HELP trmnl_petcare_litter_filter_due_timestamp_seconds LR5 filter replacement due time as a Unix timestamp.",
        "# TYPE trmnl_petcare_litter_filter_due_timestamp_seconds gauge",
        metric(
          "trmnl_petcare_litter_filter_due_timestamp_seconds",
          new Date(robot.filterDueAt).getTime() / 1000,
        ),
      );
    }
  }
  if (collection.metrics.litterHaMismatch !== null) {
    lines.push(
      "# HELP trmnl_petcare_litter_ha_mismatch Whether ordinary HA LR5 entities disagree with fresh Whisker diagnostics.",
      "# TYPE trmnl_petcare_litter_ha_mismatch gauge",
      metric(
        "trmnl_petcare_litter_ha_mismatch",
        bool(collection.metrics.litterHaMismatch),
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

function bool(value: boolean): number {
  return value ? 1 : 0;
}

function metric(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): string {
  const entries = Object.entries(labels);
  const renderedLabels =
    entries.length === 0
      ? ""
      : `{${entries.map(([key, label]) => `${key}="${escapeLabel(label)}"`).join(",")}}`;
  return `${name}${renderedLabels} ${value.toString()}`;
}

function escapeLabel(value: string): string {
  const slash = String.fromCodePoint(92);
  return value
    .replaceAll(slash, slash.repeat(2))
    .replaceAll("\n", `${slash}n`)
    .replaceAll('"', `${slash}"`);
}
