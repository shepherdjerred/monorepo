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
  filterDueAt: string | null;
  totalCycles: number;
  sourceFresh: boolean;
  faulted: boolean;
};

export class PetCareHomeAssistantClient {
  private readonly rest: HomeAssistantRestClient;
  private readonly baseUrl: string;
  private readonly token: string;
  private configEntryId: string | undefined;

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
      minimalResponse: true,
      significantChangesOnly: true,
    });
  }

  public async getLitterRobot(now = new Date()): Promise<LitterRobotSnapshot> {
    const configEntryId =
      this.configEntryId ?? (await this.discoverLitterRobotConfigEntry());
    this.configEntryId = configEntryId;
    const diagnostics = await this.rest.getConfigEntryDiagnostics(
      configEntryId,
      WhiskerDiagnosticsSchema,
    );
    return parseLitterRobotDiagnostics(diagnostics, now);
  }

  private async discoverLitterRobotConfigEntry(): Promise<string> {
    const client = new HomeAssistantEventClient(
      { baseUrl: this.baseUrl, token: this.token },
      { reconnect: false },
    );
    try {
      await client.connect();
      const registry = await client.getEntityRegistry();
      const ids = new Set(
        registry
          .filter((entry) => entry.platform === "litterrobot")
          .filter((entry) => entry.entity_id.startsWith("vacuum."))
          .flatMap((entry) =>
            entry.config_entry_id == null ? [] : [entry.config_entry_id],
          ),
      );
      if (ids.size !== 1) {
        throw new Error(
          `Expected one Whisker config entry for a litterrobot vacuum, found ${ids.size.toString()}`,
        );
      }
      const [id] = ids;
      if (id === undefined) {
        throw new Error("Whisker config entry discovery returned no ID");
      }
      return id;
    } finally {
      await client.close();
    }
  }
}

export function parseLitterRobotDiagnostics(
  diagnostics: z.infer<typeof WhiskerDiagnosticsSchema>,
  now = new Date(),
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
    filterDueAt: robot.nextFilterReplacementDate,
    totalCycles: state.odometerCleanCycles,
    sourceFresh:
      now.getTime() - new Date(state.lastSeen).getTime() <= 15 * 60 * 1000,
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
  if (combined.includes("ready")) {
    return { health: "ready", label };
  }
  return { health: "unknown", label };
}
