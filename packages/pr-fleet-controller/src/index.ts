import { FleetController } from "./controller.ts";
import type { FleetControllerDependencies } from "./ports.ts";

export function createFleetController(
  dependencies: FleetControllerDependencies,
): FleetController {
  return new FleetController(dependencies);
}
