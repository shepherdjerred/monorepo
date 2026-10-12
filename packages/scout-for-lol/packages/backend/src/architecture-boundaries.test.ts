import { describeArchitectureBoundaries } from "@shepherdjerred/architecture/testing";
import architecture, { layers } from "#architecture";

describeArchitectureBoundaries({
  packageRoot: import.meta.dir.replace(/\/src$/u, ""),
  architecture,
  layers,
});
