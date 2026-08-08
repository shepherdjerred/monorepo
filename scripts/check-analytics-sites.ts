import { z } from "zod";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const registryPath = `${root}/config/analytics-sites.json`;

const RegistrySchema = z.object({
  trackerOrigin: z.literal("https://matomo.sjer.red"),
  sites: z.array(
    z.object({
      hostname: z.string().min(1),
      siteId: z.number().int().positive(),
    }),
  ),
});

const staticTrackers = [
  {
    path: "packages/sjer.red/src/layouts/BaseLayout.astro",
    hostname: "sjer.red",
  },
  { path: "packages/resume/index.html", hostname: "resume.sjer.red" },
  { path: "packages/webring/matomo.js", hostname: "webring.sjer.red" },
  {
    path: "packages/better-skill-capped/index.html",
    hostname: "better-skill-capped.com",
  },
  {
    path: "packages/discord-plays-mario-kart/packages/frontend/index.html",
    hostname: "discord-plays-mario-kart.com",
  },
  {
    path: "packages/discord-plays-pokemon/packages/frontend/index.html",
    hostname: "discord-plays-pokemon.com",
  },
] as const;

const registry = RegistrySchema.parse(
  JSON.parse(await Bun.file(registryPath).text()) as unknown,
);

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
  const siteIds = [...source.matchAll(/\["setSiteId",\s*(\d+)\]/g)].map(
    (match) => match[1],
  );
  if (siteIds.length !== 1 || siteIds[0] !== String(site.siteId)) {
    throw new Error(
      `${tracker.path} must set Matomo site ID ${String(site.siteId)} from ${tracker.hostname}`,
    );
  }
  if (!source.includes(`${registry.trackerOrigin}/matomo.php`)) {
    throw new Error(`${tracker.path} must use ${registry.trackerOrigin}`);
  }
}

console.log(
  `Validated ${String(staticTrackers.length)} static Matomo trackers`,
);
