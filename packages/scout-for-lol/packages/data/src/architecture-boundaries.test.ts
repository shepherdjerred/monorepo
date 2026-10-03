import { describeArchitectureBoundaries } from "@shepherdjerred/architecture/testing";
import architecture, { layers } from "#architecture";

describeArchitectureBoundaries({
  packageRoot: import.meta.dir.replace(/\/src$/u, ""),
  architecture,
  layers,
  layerSource: {
    includeModules: true,
    expand: ["model"],
    // `model/legacy` is scheduled for deletion and intentionally unlisted.
    ignore: ["model/legacy"],
  },
});
