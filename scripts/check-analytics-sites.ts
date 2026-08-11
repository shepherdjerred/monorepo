import { z } from "zod";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const registryPath = `${root}/config/analytics-sites.json`;

const RegistrySchema = z.object({
  provider: z.literal("posthog"),
  projectToken: z.string().regex(/^phc_[A-Za-z0-9]+$/),
  apiHost: z.literal("https://us.i.posthog.com"),
  assetHost: z.literal("https://us-assets.i.posthog.com"),
  sites: z.array(
    z.object({
      key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      hostname: z.string().min(1),
      sessionReplay: z.boolean(),
    }),
  ),
});

const staticTrackers = [
  {
    path: "packages/sjer.red/src/layouts/BaseLayout.astro",
    hostname: "sjer.red",
  },
  { path: "packages/resume/index.html", hostname: "resume.sjer.red" },
  { path: "packages/webring/posthog.js", hostname: "webring.sjer.red" },
  {
    path: "packages/better-skill-capped/index.html",
    hostname: "better-skill-capped.com",
  },
  {
    path: "packages/discord-plays-mario-kart/packages/frontend/index.html",
    hostname: "mariokart.sjer.red",
  },
  {
    path: "packages/discord-plays-pokemon/packages/frontend/index.html",
    hostname: "pokebot.sjer.red",
  },
] as const;

const registry = RegistrySchema.parse(
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
]);
const actualHostnames = new Set(registry.sites.map((site) => site.hostname));
if (
  actualHostnames.size !== expectedHostnames.size ||
  [...expectedHostnames].some((hostname) => !actualHostnames.has(hostname))
) {
  throw new Error(
    "Analytics registry must contain exactly the eight portfolio hosts",
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

  const source = await Bun.file(`${root}/${tracker.path}`).text();
  if (!source.includes(registry.projectToken)) {
    throw new Error(
      `${tracker.path} must use the shared PostHog project token for ${tracker.hostname}`,
    );
  }
  if (
    !source.includes(registry.apiHost) ||
    !source.includes(registry.assetHost)
  ) {
    throw new Error(`${tracker.path} must use the PostHog US hosts`);
  }
  if (!source.includes(`asset_host: "${registry.assetHost}"`)) {
    throw new Error(`${tracker.path} must configure the PostHog asset host`);
  }
  if (!source.includes(`site_key: "${site.key}"`)) {
    throw new Error(
      `${tracker.path} must register PostHog site key ${site.key}`,
    );
  }
  if (!source.includes("disable_session_recording: false")) {
    throw new Error(`${tracker.path} must enable session replay`);
  }
  for (const captureSetting of [
    "autocapture: true",
    'capture_pageview: "history_change"',
    "capture_pageleave: true",
    "capture_heatmaps: true",
    "capture_dead_clicks: true",
    "capture_performance: { web_vitals: true, network_timing: true }",
    "session_recording: { maskAllInputs: true }",
  ]) {
    if (!source.includes(captureSetting)) {
      throw new Error(
        `${tracker.path} must configure PostHog capture setting ${captureSetting}`,
      );
    }
  }
  for (const privacySetting of [
    "respect_dnt: true",
    'person_profiles: "always"',
  ]) {
    if (!source.includes(privacySetting)) {
      throw new Error(
        `${tracker.path} must configure PostHog privacy setting ${privacySetting}`,
      );
    }
  }
  // These three keys are load-bearing by their ABSENCE, and each one silently
  // degrades collection rather than failing loudly:
  //   cookieless_mode — PostHog's ingestion drops cookieless events unless the
  //     project enables cookieless server hash mode; capture still returns 200.
  //   persistence     — an override to "memory" resets the distinct id on every
  //     page load, so unique visitors collapse into page loads.
  //   before_send     — the old hook rewrote $current_url to origin+pathname,
  //     discarding the campaign query strings attribution depends on.
  for (const forbidden of ["cookieless_mode", "persistence:", "before_send"]) {
    if (source.includes(forbidden)) {
      throw new Error(`${tracker.path} must not set ${forbidden}`);
    }
  }
  if (
    !source.includes("e.__SV") ||
    !source.includes("e._i.push") ||
    !source.includes('"/static/array.js"')
  ) {
    throw new Error(
      `${tracker.path} must use PostHog's official queueing snippet`,
    );
  }
}

const scoutBootstrapPath =
  "packages/scout-for-lol/packages/frontend/public/posthog-bootstrap.js";
const scoutBootstrap = await Bun.file(`${root}/${scoutBootstrapPath}`).text();
for (const requiredSetting of [
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
  "session_recording: { maskAllInputs: true }",
]) {
  if (!scoutBootstrap.includes(requiredSetting)) {
    throw new Error(
      `${scoutBootstrapPath} must configure Scout PostHog setting ${requiredSetting}`,
    );
  }
}
for (const forbidden of ["cookieless_mode", "persistence:", "before_send"]) {
  if (scoutBootstrap.includes(forbidden)) {
    throw new Error(`${scoutBootstrapPath} must not set ${forbidden}`);
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
