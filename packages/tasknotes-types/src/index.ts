// The `.` entry resolves to the v2 contract — the upstream TaskNotes plugin
// HTTP API (`@tasknotes/model` shapes + wire mirrors). The interim legacy
// camelCase surface was removed in P6; the app now owns its internal
// camelCase vocabulary (see tasks-for-obsidian/src/domain/base-schemas.ts).
export * from "./v2.ts";
