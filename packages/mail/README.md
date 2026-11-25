# `@shepherdjerred/mail`

First-party outbound transactional mail broker and operator console for the homelab.

`@shepherdjerred/mail` accepts outbound email from first-party services and self-hosted cluster workloads over authenticated HTTP (`:7371`) and `STARTTLS` ESMTP (`:25`), persists every message in a durable SQLite WAL outbox, drains deliveries through Fastmail SMTP submission (`smtp.fastmail.com:587`), and serves a Hub-style operator web console and Prometheus metrics on `:7370`.

## Architecture & Listeners

| Port    | Protocol           | Surface & Purpose                                                                                                                                               |
| ------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:7370` | HTTP               | Operator web console SPA (`/`, `/messages/:id`), admin JSON API (`/api/admin/*`), liveness/readiness probes (`/healthz`, `/readyz`), and Prometheus `/metrics`. |
| `:7371` | HTTP (`Bearer`)    | Authenticated in-cluster submission API (`POST /v1/messages`) and delivery receipt lookup (`GET /v1/messages/:id`) using per-caller tokens.                     |
| `:25`   | ESMTP (`STARTTLS`) | In-cluster SMTP submission listener for third-party workloads (`alertmanager`, `storm-forum-prod`, `bugsink`, `seerr`) authenticating with caller credentials.  |

### Outbox & Fastmail Relay State Machine

1. **Ingress & Deduplication**: Callers submit structured payloads (`POST /v1/messages` validated with `SendMessageRequestSchema` in `src/shared/contract.ts`) or raw RFC 5322 MIME messages over `STARTTLS` SMTP (`:25`, parsed with `postal-mime`). When an `idempotencyKey` is supplied on `:7371`, duplicate submissions for the same caller return the existing message receipt with `deduplicated: true`.
2. **Durable Queue (`queued`)**: Accepted messages are written synchronously into SQLite (`WAL` mode) with status `queued`, normalized headers, raw MIME bytes, envelope sender/recipients, and `nextAttemptAt`.
3. **Relay Drain (`sending` -> `sent` | `retrying` | `failed`)**:
   - While Flags boolean flag `mail-relay-enabled` is `true`, the background relay worker claims due `queued` / `retrying` rows (`status = "sending"`) and submits them to Fastmail (`smtp.fastmail.com:587`).
   - Every upstream SMTP attempt is recorded in `delivery_attempts` (`attemptNumber`, `startedAt`, `finishedAt`, `durationMs`, `outcome`, `smtpCode`, `smtpResponse`, `error`).
   - `2xx` responses transition the message to `sent` and stamp `sentAt`.
   - `4xx` / transient network errors record `transient_error` and schedule exponential backoff in `retrying` (`nextAttemptAt`) until the max attempt budget is exhausted.
   - `5xx` permanent rejections (or exhausted retries) record `permanent_error`, transition to `failed`, and stamp `failedAt`.
4. **Manual Recovery & Retention**: Operators inspect full payloads, headers, and SMTP attempt transcripts in the `:7370` console and trigger `POST /api/admin/messages/:id/retry` on `failed` or `retrying` messages to re-queue delivery immediately. Terminal rows older than `retentionDays` are pruned automatically.

## Configuration & Feature Flags

Bootstrap and credentials are provided via environment variables (`src/server/config.ts`); operational behavior is governed dynamically via `@shepherdjerred/feature-flags` (`mail/prod`).

### Feature Flags (`mail/prod`)

| Flag Key             | Type      | Default                                                                               | Purpose                                                                                                           |
| -------------------- | --------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `mail-relay-enabled` | `boolean` | `true`                                                                                | Drains queued outbound mail from SQLite WAL to Fastmail SMTP submission; when `false`, submissions queue safely.  |
| `mail-settings`      | `variant` | `{"retentionDays":30,"maxPerClientPerTenMinutes":200,"allowCleartextSmtpAuth":false}` | JSON operational settings for outbox retention window, per-caller 10-minute rate limit, and SMTP TLS auth policy. |

### Environment Variables

| Variable                                             | Purpose                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `HOST` / `PORT`                                      | Bind address (`0.0.0.0`) and port (`7370`) for the operator console, admin API, probes, and `/metrics`.        |
| `MAIL_API_PORT`                                      | Port for the authenticated in-cluster `/v1/messages` HTTP submission listener (`7371` in production).          |
| `MAIL_SMTP_PORT`                                     | Port for the in-cluster `STARTTLS` ESMTP submission listener (`25` in production).                             |
| `MAIL_DATABASE_PATH`                                 | Filesystem path to the SQLite WAL database file (defaults to `:memory:` when unset in tests/local dev).        |
| `MAIL_CLIENTS_JSON`                                  | JSON map of caller IDs (`alert-dashboard`, `media`, `temporal`, `alertmanager`, etc.) to credentials/scopes.   |
| `FASTMAIL_SMTP_HOST` / `FASTMAIL_SMTP_PORT`          | Upstream SMTP submission endpoint (defaults to `smtp.fastmail.com` and `587`).                                 |
| `FASTMAIL_SMTP_USERNAME`                             | Fastmail SMTP submission username (1Password-backed secret).                                                   |
| `FASTMAIL_SMTP_PASSWORD`                             | Fastmail app password for outbound SMTP submission (1Password-backed secret).                                  |
| `FASTMAIL_SMTP_REQUIRE_TLS`                          | Require TLS on upstream Fastmail SMTP connections (defaults to `true`).                                        |
| `MAIL_SMTP_TLS_CERT_PATH` / `MAIL_SMTP_TLS_KEY_PATH` | PEM certificate and private key paths served by `STARTTLS` on `:25` (cert expiry surfaced in console).         |
| `MAIL_SMTP_HOSTNAME`                                 | ESMTP banner hostname advertised on `:25` (defaults to `mail.mail.svc.cluster.local`).                         |
| `MAIL_RELAY_ENABLED_FALLBACK`                        | Bootstrap fallback (`true` / `false`) for `mail-relay-enabled` when feature flags are disabled or unreachable. |
| `FEATURE_FLAGS_MODE`                                 | `@shepherdjerred/feature-flags` mode (`disabled`, `flags`, `static`) targeting deployment `mail/prod`.         |

## Operator Web Console

The `:7370` SPA (`src/client/`) shares the `@shepherdjerred/console-ui` design system and `ops-theme` preference (`system` / `light` / `dark`) with Hub, Flags, and Go links:

- **Outbox (`/`)**: Headline `FigureStrip` (`Queued / retrying`, `Sent (24h)`, `Failed (24h)`, `Stored`), Fastmail relay & SMTP TLS certificate expiry status in `HeaderBar`, sidebar filters by delivery state and caller (`Hub`, `Media`, `Temporal`, `Alertmanager`, `Storm Forum`, `Bugsink`, `Seerr`), `/` keyboard search shortcut, and accessible `America/Los_Angeles` message table.
- **Message Detail (`/messages/:id`)**: Structured envelope/header metadata, one-click `Retry delivery` for `failed` and `retrying` messages, plain-text body view, strictly sandboxed HTML preview (`<iframe sandbox="" referrerPolicy="no-referrer" srcDoc={...} />`), and SMTP delivery attempt + header tables.

## Development

Run commands from `packages/mail` (or via root `bunx turbo run ... --filter=@shepherdjerred/mail`):

```bash
bun run dev         # Start Vite dev server on 127.0.0.1:7373 (proxies /api, /metrics, /healthz, /readyz to 127.0.0.1:7370)
bun run start       # Run the Bun mail broker entrypoint (src/index.ts)
bun run build       # Build production client assets into dist/client
bun run typecheck   # Run native TypeScript strict typecheck
bun run test        # Run Vitest unit and render suites under src/
bun run lint        # Run ESLint with zero warnings allowed
```
