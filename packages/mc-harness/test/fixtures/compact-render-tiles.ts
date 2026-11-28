import { Renderer } from "@shepherdjerred/mc-build/render/index.ts";
import { beforeAll, vi } from "vitest";

/** Keep real rendering and PNG evidence in suites that assert file and checkpoint behavior. */
export function useCompactRenderTiles(): void {
  beforeAll(() => {
    const descriptors: Partial<{
      sheet: TypedPropertyDescriptor<Renderer["sheet"]>;
      judgeSheet: TypedPropertyDescriptor<Renderer["judgeSheet"]>;
    }> = Object.getOwnPropertyDescriptors(Renderer.prototype);
    const sheet = descriptors.sheet?.value;
    const judgeSheet = descriptors.judgeSheet?.value;
    if (typeof sheet !== "function" || typeof judgeSheet !== "function") {
      throw new TypeError(
        "Expected sheet and judgeSheet methods on Renderer.prototype",
      );
    }
    const contactSheet = vi
      .spyOn(Renderer.prototype, "sheet")
      .mockImplementation(function (this: Renderer, grid, options) {
        return sheet.call(this, grid, { ...options, tile: options.tile ?? 64 });
      });
    const judgingSheet = vi
      .spyOn(Renderer.prototype, "judgeSheet")
      .mockImplementation(function (this: Renderer, grid, options) {
        return judgeSheet.call(this, grid, {
          ...options,
          tile: options.tile ?? 64,
        });
      });
    return () => {
      contactSheet.mockRestore();
      judgingSheet.mockRestore();
    };
  });
}
