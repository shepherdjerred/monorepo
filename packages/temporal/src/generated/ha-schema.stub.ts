/**
 * Committed stub — contains NO sensitive data. Copied to `ha-schema.ts`
 * by `scripts/ensure-ha-schema.ts` when no generated schema exists yet, so
 * typecheck works without a live HA instance. Replaced in full by
 * `bun run generate` (which invokes ha-codegen against the live instance).
 *
 * The generated output at `ha-schema.ts` is gitignored — never commit it.
 *
 * Using DefaultHaSchema keeps the stub permissive (plain strings accepted);
 * the codegen output narrows to literal unions from the live instance.
 */
/* eslint-disable */
import type { DefaultHaSchema } from "@shepherdjerred/home-assistant";

export const entities: DefaultHaSchema["entities"] = {};
export const services: DefaultHaSchema["services"] = {};
export const events: readonly string[] = [];
export type EventData = Record<string, never>;
export type HaSchema = DefaultHaSchema;
