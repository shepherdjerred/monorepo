import { FleetController } from "./controller/fleet-controller.ts";
import type { FleetControllerDependencies } from "./domain/ports.ts";

export function createFleetController(
  dependencies: FleetControllerDependencies,
): FleetController {
  return new FleetController(dependencies);
}
