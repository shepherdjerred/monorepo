import { z } from "zod";
import { Coordinate, PageIndex, Size } from "./board-primitives.ts";

const NoteColor = z.string().min(1).max(32);

/** A freehand stroke is simplified to at most this many points before it is stored. */
export const MAX_PEN_POINTS = 500;

export const NoteSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("sticky"),
    page: PageIndex,
    x: Coordinate,
    y: Coordinate,
    w: Size,
    h: Size,
    text: z.string().max(2000),
    color: NoteColor.optional(),
  }),
  z.strictObject({
    type: z.literal("title"),
    page: PageIndex,
    x: Coordinate,
    y: Coordinate,
    text: z.string().max(500),
    size: z.enum(["s", "m", "l"]).default("m"),
  }),
  z.strictObject({
    type: z.literal("box"),
    page: PageIndex,
    x: Coordinate,
    y: Coordinate,
    w: Size,
    h: Size,
    color: NoteColor.optional(),
  }),
  z.strictObject({
    type: z.literal("line"),
    page: PageIndex,
    x: Coordinate,
    y: Coordinate,
    x2: Coordinate,
    y2: Coordinate,
    color: NoteColor.optional(),
  }),
  z.strictObject({
    type: z.literal("pen"),
    page: PageIndex,
    /** The stroke's origin; `points` are offsets from it, so a move changes only x and y. */
    x: Coordinate,
    y: Coordinate,
    points: z
      .array(z.tuple([Coordinate, Coordinate]))
      .min(2)
      .max(MAX_PEN_POINTS),
    color: NoteColor.optional(),
  }),
  z.strictObject({
    type: z.literal("arrow"),
    page: PageIndex,
    x: Coordinate,
    y: Coordinate,
    x2: Coordinate,
    y2: Coordinate,
    color: NoteColor.optional(),
  }),
]);
