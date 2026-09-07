# Changelog

All notable changes to this package are documented in this file.

## 0.1.0 (2026-09-07)


First public release of the typed Home Assistant REST and WebSocket client for Node.js and Bun.

- Publishes compiled ESM, TypeScript declarations, and the `ha-codegen` CLI for generating an instance-specific schema; package exports now resolve through `dist/` ([16c7c62](https://github.com/shepherdjerred/monorepo/commit/16c7c623e8fb8cfd03b3d1eec5168f0d0636b53d))
- Exposes schema-validated REST and WebSocket clients for reading states, calling services, subscribing to events, and generating typed entity/service/event access from a Home Assistant instance ([16c7c62](https://github.com/shepherdjerred/monorepo/commit/16c7c623e8fb8cfd03b3d1eec5168f0d0636b53d))
- Adds public reads for Home Assistant entity-registry entries and integration config-entry diagnostics, with runtime validation and exported schemas ([d1d171d](https://github.com/shepherdjerred/monorepo/commit/d1d171d12e2b79df04ad461ff7281c77601e1e66))
- Requires Node.js 24 or newer (or Bun) and ships the README, license, examples, demos, and changelog in the npm package ([16c7c62](https://github.com/shepherdjerred/monorepo/commit/16c7c623e8fb8cfd03b3d1eec5168f0d0636b53d))

## 0.1.0

- First public release of the typed Home Assistant REST and WebSocket client.
- Added the `ha-codegen` command for generating instance-specific schemas.
