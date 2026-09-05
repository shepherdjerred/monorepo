# Scout constraints

Scout is the League of Legends product spanning Discord, backend APIs, web and
desktop clients, reporting, analytics, a DuckDB report lake, and Temporal.
`README.md` and the Scout wiki explanations own architecture and contributor
reference. Load `scout-development` for its working procedure.

## Product boundaries

- `/scout ask` creates a private saved Explore conversation. Explore owns
  conversational query authoring and continuation.
- Bryan Bucks owns Dare viewing and management. Preserve origin conversation
  links without moving management into Explore.
- Version stored betting and Dare semantics. Existing records keep their
  original cross-game or same-game interpretation.
- Challenger stake, pile-ons, pot total, settlement, and Discord presentation
  are different values. Do not collapse them.
- Tournament-code custom games and Riot match ingestion keep distinct
  provenance. Generic Dare conditions remain cross-game unless wording
  explicitly requires one/same game.

## Data and execution

- Raw match and prematch JSON in S3 is canonical. The local Parquet/DuckDB
  report lake is derived and rebuildable.
- ScoutQL goes through the closed parser, compiler, and evaluator. Guild/global
  scope and identity are explicit. Any participant limit requiring stable
  selection orders by game end, match, and player identity.
- Validate Riot, Discord, model, database, and object-store boundaries. Internal
  contract violations fail loudly; user input gets a useful response.
- Prisma tests disconnect clients. Local routine tests use fixtures and the
  documented dev-session/bootstrap path, not a real Discord login.
- Temporal owns recurring polling, refresh, maintenance, and evaluation jobs.
  Preserve Workflow determinism and versioning for open histories.

## UI, messages, and analytics

Use the shared design system and report renderer. Satori output follows the
repository report-rendering constraints. Non-core Discord message budgets are
user promises; preserve pagination, mention safety, and stable formatting.

Server analytics use the documented privacy-scoped identity and event schemas.
Source capture success does not prove PostHog stored the event.

## Delivery

Run focused Turbo tasks for affected Scout workspaces. Use the existing seeded
report lake and browser/Discord fixtures for integration and visual proof.

Beta continuously receives built images; production is promoted through the
catalog/GitOps path. Verify source, exact-head Buildkite, image digest, ArgoCD
revision, logs, and the user flow independently. Never infer deployment from a
green source check.
