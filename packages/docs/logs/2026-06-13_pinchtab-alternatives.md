# PinchTab Alternatives — Q&A

## Status

Complete

## Question

"Are there any good alternatives to PinchTab?"

## Context

PinchTab fills these roles in this setup: real Chrome (vs. the lightweight `lightpanda`
fast path), anti-detection/stealth, profiles + multi-instance routing, interactive page
actions (click/fill/screenshot), CLI-driven, and self-hostable as a K8s service. The
answer was framed by which of those dimensions a replacement needs to cover.

`toolkit recall search` found no prior comparison of browser tools — only operational
PinchTab pod checks and PinchTab's own fetched docs — so the answer was assembled fresh.

## Answer summary

Top picks for this stack:

- **Playwright** — TS-native, the default for the _interactive/scripted_ side.
- **steel-browser** (OSS) — closest self-hosted analog to PinchTab-as-a-service
  (sessions + stealth + proxy, Docker).
- **browserless** — self-hosted headless Chrome service with concurrency/pooling.
- **Camoufox / Patchright** — for the _anti-detection_ angle with a Playwright-shaped API.

By dimension:

- Scripted real Chrome (TS): Playwright (rec) / Puppeteer.
- Stealth-first: Patchright, Camoufox, rebrowser-patches, nodriver / undetected-chromedriver / SeleniumBase-UC (Python).
- Profiles + per-profile fingerprint/proxy (antidetect-browser model): GoLogin, AdsPower, Multilogin, Dolphin Anty, Kameleo (all commercial/SaaS).
- Hosted: Browserbase, Steel cloud, Hyperbrowser, Bright Data Scraping Browser.
- AI-agent navigation: Stagehand, browser-use, Skyvern.

Recommendation: Playwright for interactive cases; steel-browser (or browserless) to keep
the remote-browser-service shape; keep `lightpanda` as the fast fetch path — none of these
displace it.

## Follow-up: when is PinchTab the right choice?

Grounded in PinchTab's own docs (fetched at `~/.recall/fetched/pinchtab.com/`): it's a
12MB Go binary (MIT) that launches real Chrome and exposes an HTTP API / CLI, built for
_AI agents_ to drive a browser cheaply — accessibility-tree nav with stable refs
(`e0`, `e1`…), readability text extraction (~1–3k tokens vs ~10k for a full snapshot),
persistent logged-in sessions ("humans log in, agents drive"), and basic stealth.

**Use PinchTab when:** an agent needs ad-hoc interactive browsing without authored
automation code; you need authenticated access to your own logged-in sessions (persisted
profile, no creds in code); token efficiency matters because browsing happens in an LLM
context; you want a tiny ops footprint (one binary/pod, already deployed); or lightpanda is
blocked and you need real Chrome with passable stealth as the `toolkit fetch --browser` fallback.

**Use an alternative when:** repeatable/version-controlled automation, CI scraping, or E2E
tests → Playwright; high-throughput parallel scraping → browserless/steel; hostile anti-bot
(Cloudflare-grade) → Camoufox/Patchright; pure fast fetch → lightpanda; complex programmatic
control flow → a Playwright script.

Dividing line: PinchTab wins when _the agent is the user of the browser_ (exploratory,
stateful, authenticated); the others win when _code is the user_ (repeatable, parallel, stealth-max).

## Correction: same-problem alternatives (agent-driven, not code-driven)

The first answer's list (Playwright, Puppeteer, browserless, Camoufox, Patchright) was
miscategorized — those are alternatives to the _browser engine you script against_ (code is
the driver). PinchTab's actual problem is **a control surface an AI agent drives directly**
(CLI/curl/HTTP, accessibility-tree refs, low tokens, persistent logged-in sessions, no authored
automation code). Of the original list only **steel** was partially in the right category.

True same-problem peers (agent-facing browser control):

- **Playwright MCP** (Microsoft, OSS) — closest peer; a11y-tree snapshots, low-token, agent-driven.
  Needs an MCP client + Node/Playwright stack; no log-in-once profile UX or stealth emphasis.
- **Browser MCP** (browsermcp.io) — MCP + extension driving your real logged-in Chrome; nearly
  identical "your sessions, agent drives, local" model.
- **Chrome DevTools MCP** (Chrome team, OSS) — MCP over CDP, a11y + perf; Chrome-specific.
- **Steel** (steel.dev / steel-browser) — agent-oriented remote browser + MCP; pool/infra-shaped.
- **Stagehand / browser-use / Skyvern** — LLM-driven agent _libraries_ (they ARE the agent), adjacent not drop-in.
- **Anthropic Computer Use / OpenAI Operator** — agent-driven but vision/coordinate based → heavy tokens, different mechanism.

Two axes that pin PinchTab down: **who drives** (agent vs. code) and **state model** (accessibility
tree + refs vs. vision/coordinates). PinchTab = agent-driven + a11y-tree + persistent real-Chrome
sessions + ultralight self-host + framework-agnostic (curl/CLI, not MCP-bound). Its edge over the
MCP peers is being a 12MB Go binary hittable with plain curl (no MCP client/Node), plus built-in
stealth, login-once profiles, and a scheduler.

## Researched: concrete same-niche alternatives (2026-06-13, live gh + web data)

PinchTab itself: `pinchtab/pinchtab`, Go, MIT, ~9.2k★, very new (created Feb 2026), actively
maintained. Niche = standalone local binary an agent drives via CLI/HTTP, a11y-tree snapshots
with stable refs (token-efficient ~5–13× savings), persistent logged-in real-Chrome sessions,
built-in stealth + humanized input (humanClick/humanType), multi-instance + dashboard, no cloud/keys.

**Tier 1 — direct peers (standalone, agent-driven, a11y refs):**

- `vercel-labs/agent-browser` — Rust CLI, 36k★, Apache-2.0, active. Closest analog: a11y snapshots
  with `@refs`, token-compressed, "replaces Playwright for agents." Lacks PinchTab's stealth/humanized
  input + login-once profiles. The genuine head-to-head competitor.
- `remorses/playwriter` — TS, 3.6k★, CLI **or** MCP + extension; controls your browser, runs Playwright
  snippets in a stateful sandbox.
- `SawyerHood/dev-browser` — 6.2k★, **a Claude Skill** giving an agent a browser — drop-in for Claude Code.

**Tier 2 — MCP browser servers (need an MCP client):**

- `ChromeDevTools/chrome-devtools-mcp` — 44k★, official Chrome team, CDP + perf/debug, active.
- `microsoft/playwright-mcp` — 34k★, Apache-2.0, active, the standard; full a11y dumps can hit ~50k tokens (PinchTab/agent-browser compress this).
- `BrowserMCP/mcp` — 6.6k★, ⚠️ STALE (last push 2025-04-24); drives your existing logged-in Chrome via extension.
- `hyperbrowserai/mcp` — 0.8k★, front-end for Hyperbrowser hosted infra.

**Tier 3 — agent frameworks/SDKs (they ARE the agent, adjacent not drop-in):**

- `browser-use/browser-use` (99k★, Python, dominant), `browserbase/stagehand` (23k★, TS SDK),
  `nottelabs/notte` (2k★), `Skyvern-AI/skyvern` (22k★, AGPL, vision), `nanobrowser/nanobrowser` (13k★, extension).

**Tier 4 — engine/infra:** `steel-dev/steel-browser` (7.2k★, OSS browser sandbox API),
`lightpanda-io/browser` (31k★, Zig, AGPL, the fast-fetch engine already in use).

**Recommendation:** true swap → `vercel-labs/agent-browser`; least friction in Claude Code →
`SawyerHood/dev-browser` (Skill) or `chrome-devtools-mcp`/`playwright-mcp` (MCP, watch token cost);
keep PinchTab for its stealth + humanized input + login-once profiles + Go-binary/curl simplicity bundle.

## Session Log — 2026-06-13

### Done

- Answered the PinchTab-alternatives question (no repo changes).
- Confirmed via `toolkit recall search` that no prior browser-tool comparison exists in history.
- Wrote this log.

### Remaining

- None. Optional follow-ups offered: steel-browser vs. browserless self-hosting deep-dive,
  or a design sketch for a Playwright-backed `toolkit fetch --browser`.

### Caveats

- Antidetect-browser options (GoLogin/AdsPower/etc.) are commercial/closed-source; only
  Playwright, Puppeteer, steel-browser, browserless, Camoufox, and Patchright are OSS/self-hostable.
