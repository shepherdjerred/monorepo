import { mkdir } from "node:fs/promises";
import path from "node:path";
import { TrainingMaps, type MapBinding } from "./plan.ts";

type OwnedMap = {
  duels: {
    command: (command: string) => Promise<{ phase: string; result: string }>;
  };
  stop: () => Promise<void>;
};

/** Only one server exists at a time, including failed map transitions. */
export class PaperMapOwner<T extends OwnedMap> {
  private current: { binding: MapBinding; owner: T } | undefined;
  private transitions = 0;
  private readonly plan: TrainingMaps;

  constructor(
    plan: TrainingMaps,
    private readonly output: string,
    private readonly open: (output: string, map: string) => Promise<T>,
  ) {
    this.plan = TrainingMaps.parse(plan);
  }

  get owner(): T {
    if (this.current === undefined)
      throw new Error("No Paper training map is open");
    return this.current.owner;
  }

  get binding(): MapBinding {
    if (this.current === undefined)
      throw new Error("No Paper training map is open");
    return this.current.binding;
  }

  async select(map: string): Promise<MapBinding> {
    const binding = this.plan.maps.find((entry) => entry.map === map);
    if (binding === undefined)
      throw new Error(`Map ${map} is outside the frozen training plan`);
    if (this.current?.binding.map === map) return this.current.binding;
    if (this.current !== undefined) {
      const state = await this.current.owner.duels.command("state");
      if (state.phase !== "LOBBY" || state.result === "live")
        throw new Error(
          "Training map changes require the previous duel to finish resetting",
        );
      await this.stop();
    }
    const directory = path.join(
      this.output,
      "maps",
      `${this.transitions.toString().padStart(4, "0")}-${map}`,
    );
    await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
    await mkdir(directory, { recursive: false, mode: 0o700 });
    this.transitions++;
    const owner = await this.open(directory, map);
    this.current = { binding, owner };
    return binding;
  }

  async stop(): Promise<void> {
    if (this.current === undefined) return;
    // Retain the handle if cleanup fails so the outer owner can retry cleanup.
    await this.current.owner.stop();
    this.current = undefined;
  }
}
