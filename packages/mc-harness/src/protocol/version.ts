/**
 * Version of the toolkit ↔ daemon IPC contract. Bump it whenever a route or
 * schema in ipc.ts changes shape, so a toolkit binary built from an older tree
 * refuses to talk to a newer daemon (and vice versa) instead of misparsing.
 */
export const PROTOCOL_VERSION = 1;
