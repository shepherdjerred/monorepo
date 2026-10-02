import { z } from "zod";
import {
  HomeAssistantEventClient,
  HomeAssistantRestClient,
  type EntityState,
} from "@shepherdjerred/home-assistant";

const DateTimeSchema = z.iso.datetime({ offset: true });

const HopperIndicatorSchema = z
  .object({
    title: z.string().min(1),
    value: z.string().min(1),
  })
  .nullable();

const LitterRobotStateSchema = z
  .object({
    isOnline: z.boolean(),
    lastSeen: DateTimeSchema,
    statusIndicator: z.object({
      title: z.string().min(1),
      type: z.string().min(1),
    }),
    dfiLevelPercent: z.number().min(0).max(100),
    litterLevelPercent: z.number().min(0).max(100),
    hopperLitterLevel: z.number().nullable(),
    hopperFault: z.string().nullable(),
    hopperStatusIndicator: HopperIndicatorSchema,
    isHopperInstalled: z.boolean(),
    hopperStateLastUpdated: DateTimeSchema.nullable(),
    isLaserDirty: z.boolean(),
    isBonnetRemoved: z.boolean(),
    isDrawerRemoved: z.boolean(),
    isDrawerFull: z.boolean(),
    globeMotorFaultStatus: z.string().min(1),
    globeMotorRetractFaultStatus: z.string().min(1),
    pinchStatus: z.string().min(1),
    isUsbFaultDetected: z.boolean(),
    isGasSensorFaultDetected: z.boolean(),
    displayCode: z.string().min(1),
    odometerCleanCycles: z.number().int().nonnegative(),
  })
  .loose();

const LitterRobotSchema = z
  .object({
    type: z.literal("LR5_PRO"),
    name: z.string().min(1),
    updatedAt: DateTimeSchema,
    state: LitterRobotStateSchema,
    nextFilterReplacementDate: DateTimeSchema.nullable(),
    hopperSettings: z.object({ mode: z.string().min(1) }),
  })
  .loose();

export const WhiskerDiagnosticsSchema = z.object({
  robots: z.array(z.unknown()),
  pets: z.array(z.unknown()),
});

export type HopperHealth =
  | "ready"
  | "low"
  | "empty"
  | "disconnected"
  | "jammed"
  | "motor-fault"
  | "fault"
  | "unknown";

export type LitterRobotSnapshot = {
  name: string;
  online: boolean;
  ready: boolean;
  litterPercent: number;
  wastePercent: number;
  hopperHealth: HopperHealth;
  hopperLabel: string;
  hopperLevelRaw: number | null;
  hopperInstalled: boolean;
  hopperEnabled: boolean;
  lastSeenAt: string;
  diagnosticsFetchedAt: string;
  entityAvailable: boolean;
  filterDueAt: string | null;
  totalCycles: number;
  sourceFresh: boolean;
  faulted: boolean;
};

export class PetCareHomeAssistantClient {
  private readonly rest: HomeAssistantRestClient;
  private readonly baseUrl: string;
  private readonly token: string;
  private association: { configEntryId: string; entityId: string } | undefined;

  public constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.rest = new HomeAssistantRestClient({ baseUrl, token });
  }

  public getStates(): Promise<EntityState[]> {
    return this.rest.getStates();
  }

  public getHistory(entityId: string, start: Date): Promise<EntityState[][]> {
    return this.rest.getHistory([entityId], {
      start,
      significantChangesOnly: true,
    });
  }

  public async getLitterRobot(now = new Date()): Promise<LitterRobotSnapshot> {
    const association =
      this.association ?? (await this.discoverLitterRobotConfigEntry());
    this.association = association;
    try {
      const [diagnostics, entity] = await Promise.all([
        this.rest.getConfigEntryDiagnostics(
          association.configEntryId,
          WhiskerDiagnosticsSchema,
        ),
        this.rest.getState(association.entityId),
      ]);
      return parseLitterRobotDiagnostics(
        diagnostics,
        now,
        entity.state !== "unavailable" && entity.state !== "unknown",
      );
    } catch (error) {
      // Rediscover on the next collection if HA reloads or renames the entity.
      this.association = undefined;
      throw error;
    }
  }

  private async discoverLitterRobotConfigEntry(): Promise<{
    configEntryId: string;
    entityId: string;
  }> {
    const client = new HomeAssistantEventClient(
      { baseUrl: this.baseUrl, token: this.token },
      { reconnect: false },
    );
    try {
      await client.connect();
      const registry = await client.getEntityRegistry();
      const entries = registry.filter(
        (entry) =>
          entry.platform === "litterrobot" &&
          entry.entity_id.startsWith("vacuum.") &&
          entry.config_entry_id != null,
      );
      if (entries.length !== 1) {
        throw new Error(
          `Expected one Whisker litterrobot vacuum association, found ${entries.length.toString()}`,
        );
      }
      const entry = entries[0];
      if (entry?.config_entry_id == null) {
        throw new Error("Whisker config entry discovery returned no ID");
      }
      return {
        configEntryId: entry.config_entry_id,
        entityId: entry.entity_id,
      };
    } finally {
      await client.close();
    }
  }
}

export function parseLitterRobotDiagnostics(
  diagnostics: z.infer<typeof WhiskerDiagnosticsSchema>,
  now = new Date(),
  entityAvailable = false,
): LitterRobotSnapshot {
  const robots = diagnostics.robots.flatMap((value) => {
    const parsed = LitterRobotSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  if (robots.length !== 1) {
    throw new Error(
      `Expected one valid LR5 Pro diagnostics record, found ${robots.length.toString()}`,
    );
  }
  const robot = robots[0];
  if (robot === undefined) {
    throw new Error("LR5 Pro diagnostics record disappeared after validation");
  }
  const state = robot.state;
  const hopper = classifyHopper(
    state.hopperStatusIndicator?.value,
    state.hopperStatusIndicator?.title,
    state.hopperFault,
  );
  const ready = state.statusIndicator.type.toUpperCase() === "READY";
  const faulted =
    !ready ||
    state.isLaserDirty ||
    state.isBonnetRemoved ||
    state.isDrawerRemoved ||
    state.isDrawerFull ||
    state.globeMotorFaultStatus !== "MtrFaultClear" ||
    state.globeMotorRetractFaultStatus !== "MtrFaultClear" ||
    state.pinchStatus !== "Clear" ||
    state.isUsbFaultDetected ||
    state.isGasSensorFaultDetected;

  return {
    name: robot.name,
    online: state.isOnline,
    ready,
    litterPercent: state.litterLevelPercent,
    wastePercent: state.dfiLevelPercent,
    hopperHealth: hopper.health,
    hopperLabel: hopper.label,
    hopperLevelRaw: state.hopperLitterLevel,
    hopperInstalled: state.isHopperInstalled,
    hopperEnabled: robot.hopperSettings.mode.toLowerCase() === "enabled",
    lastSeenAt: state.lastSeen,
    diagnosticsFetchedAt: now.toISOString(),
    entityAvailable,
    filterDueAt: robot.nextFilterReplacementDate,
    totalCycles: state.odometerCleanCycles,
    // lastSeen/updatedAt are device change timestamps, not poll heartbeats.
    // A validated fetch and the associated HA entity's availability establish
    // source health; Prometheus separately checks the fetch observation's age.
    sourceFresh: entityAvailable,
    faulted,
  };
}

function classifyHopper(
  value: string | undefined,
  title: string | undefined,
  fault: string | null,
): { health: HopperHealth; label: string } {
  const label = title ?? value ?? fault ?? "Unavailable";
  const combined = [value, title, fault]
    .filter((part) => part != null)
    .join(" ")
    .toLowerCase();
  if (combined.includes("jam")) {
    return { health: "jammed", label };
  }
  if (combined.includes("motor")) {
    return { health: "motor-fault", label };
  }
  if (
    fault != null ||
    combined.includes("fault") ||
    combined.includes("error")
  ) {
    return { health: "fault", label };
  }
  if (combined.includes("disconnect") || combined.includes("not connected")) {
    return { health: "disconnected", label };
  }
  if (combined.includes("empty")) {
    return { health: "empty", label };
  }
  if (combined.includes("low")) {
    return { health: "low", label };
  }
  return combined.includes("ready")
    ? { health: "ready", label }
    : { health: "unknown", label };
}
