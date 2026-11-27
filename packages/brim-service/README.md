# Brim service

Brim serves coding-agent history, usage, subscription quota, billing, and live
Herdr chat priorities across workstations. Hub uses `/brim` for the browser
interface. The Brim CLI and Herdr use the same quota and priority records.

## Data ownership

- Workstations publish transcript changes through `brim sync`. SeaweedFS
  retains the encrypted transcript archive. The cluster refreshes a private,
  rebuildable mirror and history index through `brim-archive-refresh`.
- A Mac with Brim capture enabled also publishes a separately encrypted
  snapshot of retained requests. Brim serves requests from the preceding 30
  days. The `captures/v1/` S3 lifecycle expires old snapshots independently
  of transcript history.
- MacBook publishes normalized quota, reset-credit, and billing readings.
  Its headless collector reads the same provider sign-ins and Keychain entries
  as the menu-bar app. Reauthentication happens in the original app or CLI.
  [MacBook collector setup](../macos-ai-subscription-tracker/README.md#macbook-collector).
- The service persists quota history and priority revisions on its backed-up
  data volume. The private mirror and search index use a separate volume.

## Client API

| Client                     | Routes                                                                  | Credential            |
| -------------------------- | ----------------------------------------------------------------------- | --------------------- |
| Hub backend                | `GET /v1/overview`, `/v1/history/*`, `/v1/priorities`                   | Hub read token        |
| Workstation Brim and Herdr | `GET /v1/quotas`, `GET /v1/priorities`, priority set, clear, and import | Device token          |
| MacBook collector          | `PUT /v1/publish/macbook`                                               | MacBook publish token |
| Temporal                   | `POST /internal/v1/sync`                                                | Scheduler token       |

Priority rows use the permanent Herdr core ID and the terminal ID. The
single-terminal endpoint returns a revision for conditional updates and
clears. A confirmed terminal end protects that identity from later imports.
Brim’s service snapshots use Cocoa reference-date seconds to preserve the
existing quota and ranking contract. Archive freshness uses UTC timestamps.
The [publisher JSON Schema](schemas/macbook-publication-v1.schema.json)
defines the Swift-to-service payload.

## Workstation enrollment

1. Install the current `toolkit` and standalone `brim` builds on each client.
   Enroll `BRIM_DEVICE_TOKEN` through toolkit's workstation credential broker.
2. Set `BRIM_SERVICE_URL` or `brim.service.url` in toolkit’s config to the
   Brim tailnet HTTPS origin. Set `brim.service.shared.providers` to the
   provider IDs verified to use MacBook’s subscription on that workstation.
3. Run `brim --json` and `brim metadata list`. Use the Herdr priority menu to
   confirm that a second client sees the mark on the same live chat.
4. Enable `brim.sync.include.desktop.stores` where Cursor or Conductor sessions
   should be archived, after all archive readers understand those source IDs.
5. Enroll the MacBook collector. Disable native Brim’s launch at login after
   Hub and Herdr acceptance, including a successful refresh after reauthentication.

## Cluster release

Use the homelab’s prepared-service release path. Publish the service image
and inactive chart before activation. The Brim workload’s 1Password item
supplies a read/list-only SeaweedFS credential, the existing archive identity,
and four distinct bearer credentials. Hub and the Temporal infra worker
receive their own scoped bearer from their own 1Password items.

After the Brim Application reconciles, check Hub’s Brim readiness and run
the `brim-archive-refresh` schedule. Confirm an indexed session from each
workstation, including a Windows session. Then compare the latest quota
readings against MacBook and exercise a priority write from two Herdr clients.

## Local checks

Use `bun run build`, `bun run typecheck`, `bun run test`, and `bun run lint`.
The archive test uses synthetic workstation data and an in-memory object
store. The image smoke target starts the service with disposable credentials
and verifies its health listener.
