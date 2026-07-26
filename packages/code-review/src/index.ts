// Pure, side-effect-free core: types, provider registry, severity/author
// parsing, the gate decision, and the shared observability event. The GitHub
// I/O that drives the gate lives behind the `./github` subpath so pure
// consumers (pr-babysit) don't pull it in.
export * from "./types.ts";
export * from "./severity.ts";
export * from "./identity.ts";
export * from "./gate.ts";
export * from "./signal.ts";
export {
  PROVIDERS,
  DEFAULT_PROVIDER_ID,
  resolveProvider,
  type ProviderId,
} from "./providers/registry.ts";
export { greptileProvider } from "./providers/greptile.ts";
export { codexProvider } from "./providers/codex.ts";
