import { parseAnalyticsRegistry } from "../lib/scout-analytics-config.ts";

const root = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const registryPath = `${root}/config/analytics-sites.json`;

// `masksAllText` marks the sites that render a signed-in Discord identity as
// ordinary DOM text. `maskAllInputs` only masks form values, so replay on those
// sites would otherwise record usernames verbatim. An element-level allowlist
// would fail open the first time a new component renders a name, so those sites
// mask every text node instead.
const staticTrackers = [
  {
    path: "packages/sjer.red/src/layouts/BaseLayout.astro",
    hostname: "sjer.red",
    masksAllText: false,
  },
  {
    path: "packages/resume/index.html",
    hostname: "resume.sjer.red",
    masksAllText: false,
  },
  {
    path: "packages/webring/posthog.js",
    entrypoint: "packages/webring/typedoc.json",
    hostname: "webring.sjer.red",
    masksAllText: false,
    wiring: /"customJs"\s*:\s*["'][^"']*posthog\.js["']/,
  },
  {
    path: "packages/better-skill-capped/index.html",
    hostname: "better-skill-capped.com",
    masksAllText: false,
  },
  {
    path: "packages/discord-plays-mario-kart/packages/frontend/index.html",
    hostname: "mariokart.sjer.red",
    masksAllText: true,
  },
  {
    path: "packages/discord-plays-pokemon/packages/frontend/index.html",
    hostname: "pokebot.sjer.red",
    masksAllText: true,
  },
  {
    path: "packages/cooklang-rich-preview/public/posthog.js",
    entrypoint: "packages/cooklang-rich-preview/src/layouts/Layout.astro",
    hostname: "cook.sjer.red",
    masksAllText: false,
    wiring: /<script[^>]+\bsrc=["']\/posthog\.js["']/,
  },
  {
    path: "packages/stocks-sjer-red/public/posthog.js",
    entrypoint: "packages/stocks-sjer-red/src/layouts/Layout.astro",
    hostname: "stocks.sjer.red",
    masksAllText: false,
    wiring: /<script[^>]+\bsrc=["']\/posthog\.js["']/,
  },
  {
    path: "packages/docs/wiki/public/posthog.js",
    entrypoint: "packages/docs/wiki/astro.config.ts",
    hostname: "wiki.sjer.red",
    masksAllText: false,
    wiring: /\bsrc\s*:\s*["']\/posthog\.js["']/,
  },
  {
    path: "packages/glitter/public/posthog.js",
    entrypoint: "packages/glitter/public/index.html",
    hostname: "ppl.glitter-boys.com",
    masksAllText: false,
    wiring: /<script[^>]+\bsrc=["']\.\/posthog\.js["']/,
  },
] as const;

// These three keys are load-bearing by their ABSENCE, and each one silently
// degrades collection rather than failing loudly:
//   cookieless_mode — PostHog's ingestion drops cookieless events unless the
//     project enables cookieless server hash mode; capture still returns 200.
//   persistence     — an override to "memory" resets the distinct id on every
//     page load, so unique visitors collapse into page loads.
//   before_send     — the old hook rewrote $current_url to origin+pathname,
//     discarding the campaign query strings attribution depends on.
// Matched as the key followed by a colon or an open paren (method shorthand)
// with optional whitespace between. A fixed `"persistence:"` substring search
// misses `persistence : "memory"`, which is valid JavaScript, so the gate would
// pass while the regression it exists to catch shipped.
const FORBIDDEN_SETTINGS: readonly { key: string; pattern: RegExp }[] = [
  { key: "cookieless_mode", pattern: /\bcookieless_mode\s*[:(]/ },
  { key: "persistence", pattern: /\bpersistence\s*[:(]/ },
  { key: "before_send", pattern: /\bbefore_send\s*[:(]/ },
];

function forbiddenSettingIn(source: string): string | undefined {
  return FORBIDDEN_SETTINGS.find((setting) => setting.pattern.test(source))
    ?.key;
}

function sessionRecordingSetting(masksAllText: boolean): string {
  return masksAllText
    ? 'session_recording: { maskAllInputs: true, maskTextSelector: "*" }'
    : "session_recording: { maskAllInputs: true }";
}

// Replay masking and autocapture masking are separate switches. `maskTextSelector`
// governs recordings only, so a site can hide a username from replay while
// autocapture still ships it as element text on every click — and with person
// profiles on, straight onto a durable profile. The sites that render an identity
// need both.
const AUTOCAPTURE_MASKING = [
  "mask_all_text: true",
  "mask_all_element_attributes: true",
] as const;

const registry = parseAnalyticsRegistry(
  JSON.parse(await Bun.file(registryPath).text()) as unknown,
);

const expectedHostnames = new Set([
  "sjer.red",
  "resume.sjer.red",
  "webring.sjer.red",
  "better-skill-capped.com",
  "mariokart.sjer.red",
  "pokebot.sjer.red",
  "scout-for-lol.com",
  "beta.scout-for-lol.com",
  "ts-mc.net",
  "ppl.glitter-boys.com",
  "cook.sjer.red",
  "stocks.sjer.red",
  "wiki.sjer.red",
]);
const actualHostnames = new Set(registry.sites.map((site) => site.hostname));
if (
  actualHostnames.size !== expectedHostnames.size ||
  [...expectedHostnames].some((hostname) => !actualHostnames.has(hostname))
) {
  throw new Error(
    "Analytics registry must contain exactly the thirteen portfolio hosts",
  );
}

const keys = new Set<string>();
for (const site of registry.sites) {
  if (keys.has(site.key)) {
    throw new Error(`Duplicate analytics site key: ${site.key}`);
  }
  keys.add(site.key);
  if (!site.sessionReplay) {
    throw new Error(`Session replay must be enabled for ${site.hostname}`);
  }
}

for (const tracker of staticTrackers) {
  const site = registry.sites.find(
    (candidate) => candidate.hostname === tracker.hostname,
  );
  if (site === undefined) {
    throw new Error(
      `Analytics registry has no site for ${tracker.hostname} (${tracker.path})`,
    );
  }

  const entrypoint = "entrypoint" in tracker ? tracker.entrypoint : undefined;
  const wiring = "wiring" in tracker ? tracker.wiring : undefined;
  const trackerSource = await Bun.file(`${root}/${tracker.path}`).text();
  if (entrypoint !== undefined) {
    if (wiring === undefined) {
      throw new Error(
        `${tracker.path} declares an entrypoint but no wiring pattern to verify it`,
      );
    }
    if (!wiring.test(await Bun.file(`${root}/${entrypoint}`).text())) {
      throw new Error(
        `${entrypoint} must wire ${tracker.path} into the ${tracker.hostname} entrypoint`,
      );
    }
  }
  if (!trackerSource.includes(registry.projectToken)) {
    throw new Error(
      `${tracker.path} must use the shared PostHog project token for ${tracker.hostname}`,
    );
  }
  if (
    !trackerSource.includes(registry.apiHost) ||
    !trackerSource.includes(registry.assetHost)
  ) {
    throw new Error(`${tracker.path} must use the PostHog US hosts`);
  }
  if (!trackerSource.includes(`asset_host: "${registry.assetHost}"`)) {
    throw new Error(`${tracker.path} must configure the PostHog asset host`);
  }
  if (!trackerSource.includes(`site_key: "${site.key}"`)) {
    throw new Error(
      `${tracker.path} must register PostHog site key ${site.key}`,
    );
  }
  if (!trackerSource.includes("disable_session_recording: false")) {
    throw new Error(`${tracker.path} must enable session replay`);
  }
  for (const captureSetting of [
    "autocapture: true",
    'capture_pageview: "history_change"',
    "capture_pageleave: true",
    "capture_heatmaps: true",
    "capture_dead_clicks: true",
    "capture_performance: { web_vitals: true, network_timing: true }",
    sessionRecordingSetting(tracker.masksAllText),
    ...(tracker.masksAllText ? AUTOCAPTURE_MASKING : []),
  ]) {
    if (!trackerSource.includes(captureSetting)) {
      throw new Error(
        `${tracker.path} must configure PostHog capture setting ${captureSetting}`,
      );
    }
  }
  for (const privacySetting of [
    "respect_dnt: true",
    'person_profiles: "always"',
  ]) {
    if (!trackerSource.includes(privacySetting)) {
      throw new Error(
        `${tracker.path} must configure PostHog privacy setting ${privacySetting}`,
      );
    }
  }
  const forbidden = forbiddenSettingIn(trackerSource);
  if (forbidden !== undefined) {
    throw new Error(`${tracker.path} must not set ${forbidden}`);
  }
  if (
    !trackerSource.includes("e.__SV") ||
    !trackerSource.includes("e._i.push") ||
    !trackerSource.includes('"/static/array.js"')
  ) {
    throw new Error(
      `${tracker.path} must use PostHog's official queueing snippet`,
    );
  }
}

const scoutBootstrapPath =
  "packages/scout-for-lol/packages/frontend/public/posthog-bootstrap.js";
const scoutBootstrap = await Bun.file(`${root}/${scoutBootstrapPath}`).text();
const requiredScoutBootstrapSettings = [
  "e.__SV",
  "e._i.push",
  "autocapture: true",
  'capture_pageview: "history_change"',
  "capture_pageleave: true",
  "capture_heatmaps: true",
  "capture_dead_clicks: true",
  "capture_performance: { web_vitals: true, network_timing: true }",
  "respect_dnt: true",
  'person_profiles: "always"',
  'session_recording: { maskAllInputs: true, maskTextSelector: "*" }',
  "mask_all_text: true",
  "mask_all_element_attributes: true",
] as const;

function assertScoutBootstrap(path: string, source: string): void {
  for (const requiredSetting of requiredScoutBootstrapSettings) {
    if (!source.includes(requiredSetting)) {
      throw new Error(
        `${path} must configure Scout PostHog setting ${requiredSetting}`,
      );
    }
  }
}

assertScoutBootstrap(scoutBootstrapPath, scoutBootstrap);

const scoutDocsBootstrapPath =
  "packages/scout-for-lol/packages/docs-site/public/posthog-bootstrap.js";
const scoutDocsBootstrap = await Bun.file(
  `${root}/${scoutDocsBootstrapPath}`,
).text();
assertScoutBootstrap(scoutDocsBootstrapPath, scoutDocsBootstrap);

const forbiddenScoutSetting = forbiddenSettingIn(scoutBootstrap);
if (forbiddenScoutSetting !== undefined) {
  throw new Error(
    `${scoutBootstrapPath} must not set ${forbiddenScoutSetting}`,
  );
}
const forbiddenScoutDocsSetting = forbiddenSettingIn(scoutDocsBootstrap);
if (forbiddenScoutDocsSetting !== undefined) {
  throw new Error(
    `${scoutDocsBootstrapPath} must not set ${forbiddenScoutDocsSetting}`,
  );
}

const scoutDocsConfigPath =
  "packages/scout-for-lol/packages/docs-site/astro.config.ts";
const scoutDocsConfig = await Bun.file(`${root}/${scoutDocsConfigPath}`).text();
for (const requiredSetting of [
  'src: "/docs/posthog-bootstrap.js"',
  '"data-posthog-project-token"',
  '"data-posthog-api-host"',
  '"data-posthog-asset-host"',
  '"data-posthog-site-key"',
  '"data-posthog-site-domain"',
  '"data-posthog-session-replay"',
]) {
  if (!scoutDocsConfig.includes(requiredSetting)) {
    throw new Error(
      `${scoutDocsConfigPath} must configure Scout docs PostHog setting ${requiredSetting}`,
    );
  }
}

if (registry.projectToken === "phc_REPLACEWITHEXISTINGPROJECTTOKEN") {
  throw new Error(
    "Replace the PostHog project-token placeholder with the existing public project token",
  );
}

console.log(
  `Validated ${String(staticTrackers.length)} static PostHog trackers`,
);
