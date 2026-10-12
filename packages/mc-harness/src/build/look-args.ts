/** Parsing of the `build render` / `build lint` looking flags. */
import { z } from "zod";
import { CROP_NAMES } from "@shepherdjerred/mc-build/render/cut.ts";
import type { RenderSource } from "./sources.ts";
import type { LookOptions } from "./helpers.ts";

const SourceSchema = z.enum(["canvas", "expected", "compiled"]);
const ModeSchema = z.enum([
  "textured",
  "value",
  "normal",
  "squint",
  "relief",
  "light",
]);
const ViewSchema = z.enum(["sheet", "elevations", "hero", "pov", "survey"]);
const CropSchema = z.enum(CROP_NAMES);

/** `--source`, or the older `--expected` flag. */
export function parseSource(values: {
  source?: string;
  expected?: boolean;
}): RenderSource {
  if (values.source !== undefined) {
    return SourceSchema.parse(values.source);
  }
  return values.expected === true ? "expected" : "canvas";
}

function integer(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new TypeError(`--${name} must be an integer, got "${raw}"`);
  }
  return value;
}

export function parseLook(values: {
  mode?: string;
  views?: string;
  grid?: string;
  floor?: string;
  section?: string;
  crop?: string;
}): LookOptions {
  const grid = integer("grid", values.grid);
  const floor = integer("floor", values.floor);
  const section = integer("section", values.section);
  return {
    ...(values.mode === undefined
      ? {}
      : { mode: ModeSchema.parse(values.mode) }),
    ...(values.views === undefined
      ? {}
      : {
          views: values.views
            .split(",")
            .map((view) => ViewSchema.parse(view.trim())),
        }),
    ...(grid === undefined ? {} : { grid }),
    ...(floor === undefined ? {} : { floor }),
    ...(section === undefined ? {} : { section }),
    ...(values.crop === undefined
      ? {}
      : { crop: CropSchema.parse(values.crop) }),
  };
}
