import {
  generateValidatedObject,
  type LlmRuntime,
} from "@shepherdjerred/llm-runtime";
import { z } from "zod";
import { canonicalWorkKey } from "@shepherdjerred/streambot/discovery/same-work.ts";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import type { PlexItemMetadata } from "@shepherdjerred/streambot/metadata/plex-catalog.ts";
import type { LibraryMetadataProvider } from "@shepherdjerred/streambot/metadata/plex.ts";
import {
  identifyLibrarySeriesKey,
  listSeriesCatalog,
  nextEpisodeInSeries,
  normalizeSeriesKey,
  parseEpisodeMarker,
  pickEpisodicCandidate,
} from "@shepherdjerred/streambot/metadata/series-progression.ts";
import {
  isBlockedSource,
  isBlockedText,
  isBlockedUrl,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import {
  scoreLibraryTitle,
  type LibraryEntry,
} from "@shepherdjerred/streambot/sources/library.ts";
import {
  sourceIdentity,
  withMode,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { YtdlpSearchResult } from "@shepherdjerred/streambot/sources/youtube-search-result.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import { VOICE_DECISIONS_MODEL } from "@shepherdjerred/streambot/voice/constants.ts";
import { getOrCreateVoiceDecisionsRuntime } from "@shepherdjerred/streambot/voice/voice-command-router.ts";
import type {
  CuratedStationItem,
  StationCurationContext,
  StationCurator,
} from "./station-types.ts";
import { expandYoutubeMix, extractYoutubeVideoId } from "./youtube-mix.ts";

const EMPTY_PLEX: ReadonlyMap<string, PlexItemMetadata> = new Map();
const SITCOM_GENRES = new Set(["comedy", "animation"]);
const SITCOM_CUE_RE = /\b(?:sitcom|comedy|animation|animated|cartoon)\b/iu;
const PURE_AUDIO_RE =
  /\b(?:official audio|audio only|provided to youtube by|lyric video)\b|\s-\sTopic\b/iu;
const BAD_OUTCOMES = new Set(["skipped", "removed", "failed"]);
const MIX_SLOTS = [0, 1, 2, 0, 2, 1, 0, 1, 2, 0] as const;
const TvQueriesSchema = z.strictObject({ queries: z.array(z.string()) });
type Item = CuratedStationItem;
type SSet = ReadonlySet<string>;
type OptStrs = readonly (string | undefined)[];
type YtList = readonly YtdlpSearchResult[];
type LibList = readonly LibraryEntry[];
type Ref = { title: string; path?: string };
type Anchor = { key: string; ref: Ref; rank: number; at: number };
type SearchFn = (q: string, s: AbortSignal, n: number) => Promise<YtList>;
type GateFn = (s: {
  guildId: string;
  channelId: string;
  userId: string;
}) => Promise<boolean>;
type RunRec = { title: string; source: Source; ok: boolean; at: number };
type MixArg = {
  videoId: string;
  limit: number;
  excludeIdentities: SSet;
  signal: AbortSignal;
};
export type TvCuratorDeps = {
  readonly history: MediaHistoryStore;
  readonly historyEnabled?: GateFn | undefined;
  readonly libraryEntries: () => Promise<LibList> | LibList;
  readonly plexMetadata?: LibraryMetadataProvider | undefined;
  readonly searchYoutube?: SearchFn | undefined;
  readonly discovery?:
    { readonly searchYoutube?: SearchFn | undefined } | undefined;
  readonly ytDlpPath?: string | undefined;
  readonly fetchMix?: ((i: MixArg) => Promise<YtList>) | undefined;
  readonly openAiApiKey?: string | undefined;
  readonly llm?: LlmRuntime | undefined;
  readonly rng?: (() => number) | undefined;
};
type State = Awaited<ReturnType<typeof buildState>>;
function ytWatchUrl(url: string): string {
  const vid = extractYoutubeVideoId(url);
  return vid === null ? url : `https://www.youtube.com/watch?v=${vid}`;
}
function createGate(ctx: StationCurationContext) {
  const { recentIdentities: rec, skippedIdentities: sk } = ctx.station;
  const raw = [...ctx.excludeIdentities, ...rec, ...sk];
  const ids = new Set(raw);
  const wks = new Set(ctx.excludeWorkKeys);
  const paths = new Set<string>();
  for (const id of raw) {
    if (id.startsWith("file:")) paths.add(id.slice(5));
    if (id.startsWith("url:")) ids.add(`url:${ytWatchUrl(id.slice(4))}`);
  }
  const accept = (item: Item): Item | null => {
    const u = item.source.kind === "url" ? ytWatchUrl(item.source.url) : "";
    const base =
      item.source.kind === "url" ? { ...item.source, url: u } : item.source;
    const s = withMode(base, ctx.mode ?? "video");
    if (isBlockedSource(s) || isBlockedText(item.title)) return null;
    if (
      s.kind === "url" &&
      (s.sportsEvent !== undefined || sportsEventForSource(s.url) !== null)
    )
      return null;
    const id = sourceIdentity(s);
    const wk = canonicalWorkKey(item.title);
    if (ids.has(id) || (wk !== "" && wks.has(wk))) return null;
    ids.add(id);
    if (s.kind === "file") paths.add(s.path);
    if (wk !== "") wks.add(wk);
    return { ...item, source: s };
  };
  return { ids, paths, accept };
}
function isWatchableYt(c: YtdlpSearchResult, src?: Source): boolean {
  const bad =
    src?.music !== undefined ||
    isBlockedUrl(c.url) ||
    isBlockedText(c.title) ||
    PURE_AUDIO_RE.test(c.title);
  if (bad || (c.channel !== undefined && /\btopic$/iu.test(c.channel.trim())))
    return false;
  try {
    return (
      new URL(c.url).hostname.toLowerCase() !== "music.youtube.com" &&
      extractYoutubeVideoId(c.url) !== null
    );
  } catch {
    return false;
  }
}
function collectTvHistory(
  deps: TvCuratorDeps,
  ctx: StationCurationContext,
  allowed: boolean,
): { runs: RunRec[]; yt: YtdlpSearchResult[] } {
  if (!allowed) return { runs: [], yt: [] };
  const { guildId, channelId, station: stn, listenerIds } = ctx;
  const vis = stn.scope === "server" ? ("server" as const) : ("mine" as const);
  const mine = stn.scope === "mine" || listenerIds.length === 0;
  const rawIds = mine ? [stn.ownerId] : listenerIds;
  const users =
    vis === "server" ? [stn.ownerId] : [...new Set(rawIds.filter(Boolean))];
  const q = { guildId, visibility: vis, query: "", provider: "", offset: 0 };
  const runs = users
    .flatMap((userId) => deps.history.browseRuns({ ...q, userId }).items)
    .map((r) => ({
      title: r.title,
      source: r.source,
      ok: !BAD_OUTCOMES.has(r.outcome ?? ""),
      at: r.started_at,
    }))
    .toSorted((a, b) => b.at - a.at);
  const okIds = new Set(
    runs.flatMap((r) => (r.ok ? [sourceIdentity(r.source)] : [])),
  );
  const yt = users.flatMap((userId) =>
    deps.history.list({ guildId, channelId, userId }, vis, 40).flatMap((c) => {
      if (c.source.kind !== "url" || !okIds.has(sourceIdentity(c.source)))
        return [];
      const y = {
        url: c.source.url,
        title: c.title,
        ...(c.channel === undefined ? {} : { channel: c.channel }),
      };
      return isWatchableYt(y, c.source) ? [y] : [];
    }),
  );
  return { runs, yt };
}
async function buildState(deps: TvCuratorDeps, raw: StationCurationContext) {
  const scope = {
    guildId: raw.guildId,
    channelId: raw.channelId,
    userId: raw.station.ownerId,
  };
  const [entries, plex, histOk] = await Promise.all([
    deps.libraryEntries(),
    deps.plexMetadata?.ensureIndexed(raw.signal) ?? EMPTY_PLEX,
    deps.historyEnabled?.(scope) ?? true,
  ]);
  raw.signal.throwIfAborted();
  const ctx = { ...raw, count: Math.max(1, raw.count) };
  return {
    deps,
    ctx,
    entries,
    plex,
    ...collectTvHistory(deps, ctx, histOk),
    gate: createGate(ctx),
  };
}
function seedOf(st: State): string {
  return st.ctx.station.seed?.trim() ?? "";
}
function acceptFile(e: LibraryEntry, st: State): Item | null {
  const d = st.plex.get(e.path)?.durationSeconds;
  const dur = d === undefined ? {} : { durationSeconds: d };
  const src: Source = { kind: "file", path: e.path, title: e.title };
  return st.gate.accept({ source: src, title: e.title, ...dur });
}
function hasSeed(seed: string, fields: OptStrs): boolean {
  if (seed === "") return false;
  const low = seed.toLowerCase();
  return fields.some(
    (f) =>
      f !== undefined &&
      f !== "" &&
      (f.toLowerCase().includes(low) || scoreLibraryTitle(f, seed) >= 55),
  );
}
function plexSeed(st: State, label: string, p?: string): boolean {
  const m = p === undefined ? undefined : st.plex.get(p);
  return hasSeed(seedOf(st), [
    label,
    m?.series,
    m?.summary,
    ...(m?.genres ?? []),
  ]);
}
function seedKeys(st: State): SSet {
  const seed = seedOf(st);
  if (seed === "") return new Set();
  const cat = listSeriesCatalog(st.entries);
  const dir = normalizeSeriesKey(seed);
  const out = new Set<string>(dir !== "" && cat.has(dir) ? [dir] : []);
  for (const [k, g] of cat)
    if (plexSeed(st, g.series, g.episodes[0]?.path)) out.add(k);
  return out;
}
function seriesAnchors(st: State): Anchor[] {
  const map = new Map<string, Anchor>();
  for (const r of st.runs) {
    if (!r.ok) continue;
    const p = r.source.kind === "file" ? { path: r.source.path } : {};
    const ref: Ref = { title: r.title, ...p };
    const key = identifyLibrarySeriesKey(st.entries, ref);
    if (key === null) continue;
    const m = parseEpisodeMarker(r.title) ?? parseEpisodeMarker(ref.path ?? "");
    const rank = (m?.season ?? 0) * 10_000 + (m?.episode ?? 0);
    const prev = map.get(key);
    if (!prev || rank > prev.rank)
      map.set(key, { key, ref, rank, at: Math.max(r.at, prev?.at ?? 0) });
  }
  return [...map.values()].toSorted((a, b) => b.at - a.at);
}
function fillEpisodic(st: State, out: Item[], pref: SSet, ok?: SSet): Item[] {
  const rng = st.deps.rng ?? Math.random;
  const base = { preferredSeriesKeys: pref, excludePaths: st.gate.paths, rng };
  const opts = ok === undefined ? base : { ...base, allowedPaths: ok };
  while (out.length < st.ctx.count) {
    const next = pickEpisodicCandidate(st.entries, opts);
    const item = next === null ? null : acceptFile(next, st);
    if (item === null) break;
    out.push(item);
  }
  return out;
}
function drainAnchor(st: State, cur: Ref, cap: number, out: Item[]): void {
  let ref = cur;
  for (let n = 0; n < cap && out.length < st.ctx.count; n += 1) {
    let next = nextEpisodeInSeries(st.entries, ref);
    while (next !== null && st.gate.paths.has(next.path))
      next = nextEpisodeInSeries(st.entries, next);
    if (next === null) return;
    ref = next;
    const item = acceptFile(next, st);
    if (item !== null) out.push(item);
  }
}
function curateContinueSeries(st: State): Item[] {
  const pref = seedKeys(st);
  const cmp = (a: Anchor, b: Anchor) =>
    Number(pref.has(b.key)) - Number(pref.has(a.key)) || b.at - a.at;
  const anchors = seriesAnchors(st).toSorted(cmp);
  const out: Item[] = [];
  for (const a of anchors)
    drainAnchor(st, a.ref, anchors.length > 1 ? 1 : st.ctx.count, out);
  const started = new Set(anchors.map((a) => a.key));
  const firsts = new Set<string>();
  for (const [k, g] of listSeriesCatalog(st.entries)) {
    if (started.has(k)) continue;
    const ep = g.episodes.find((x) => !st.gate.paths.has(x.path));
    if (ep !== undefined) firsts.add(ep.path);
  }
  fillEpisodic(st, out, pref, firsts);
  return fillEpisodic(st, out, pref);
}
function curateSitcoms(st: State): Item[] {
  const seed = seedOf(st);
  const plexOk = new Set<string>();
  const cueOk = new Set<string>();
  const rawOk = new Set<string>();
  for (const e of st.entries) {
    if (parseEpisodeMarker(e) === null) continue;
    const m = st.plex.get(e.path);
    if (m !== undefined) {
      if (
        (m.durationSeconds ?? 0) <= 2700 &&
        m.genres.some((g) => SITCOM_GENRES.has(g.toLowerCase()))
      )
        plexOk.add(e.path);
      continue;
    }
    rawOk.add(e.path);
    if (
      SITCOM_CUE_RE.test(`${e.library} ${e.relativePath} ${e.title}`) ||
      hasSeed(seed, [e.title, e.series])
    )
      cueOk.add(e.path);
  }
  const sk = seedKeys(st);
  const pref = sk.size > 0 ? sk : new Set(seriesAnchors(st).map((a) => a.key));
  const ok = plexOk.size > 0 ? plexOk : cueOk.size > 0 ? cueOk : rawOk;
  return fillEpisodic(st, [], pref, ok);
}
function scoreMovie(
  e: LibraryEntry,
  st: State,
  seen: SSet,
  gMap: Map<string, number>,
): number | null {
  if (st.gate.paths.has(e.path) || parseEpisodeMarker(e) !== null) return null;
  const m = st.plex.get(e.path);
  if (
    m !== undefined &&
    m.sectionType !== "movie" &&
    (m.durationSeconds ?? 0) < 3600
  )
    return null;
  let s = seen.has(e.path) ? 0 : 50;
  for (const g of m?.genres ?? [])
    s += Math.min(30, (gMap.get(g.toLowerCase()) ?? 0) * 12);
  if (plexSeed(st, e.title, e.path)) s += 120;
  return s + (st.deps.rng ?? Math.random)() * 0.9;
}
function curateMovies(st: State): Item[] {
  const seen = new Set<string>();
  const genres = new Map<string, number>();
  for (const r of st.runs) {
    if (r.source.kind !== "file") continue;
    seen.add(r.source.path);
    if (r.ok && parseEpisodeMarker(r.title) === null) {
      for (const g of st.plex.get(r.source.path)?.genres ?? [])
        genres.set(g.toLowerCase(), (genres.get(g.toLowerCase()) ?? 0) + 1);
    }
  }
  const scored = st.entries.flatMap((e) => {
    const s = scoreMovie(e, st, seen, genres);
    return s === null ? [] : [{ e, s }];
  });
  const out: Item[] = [];
  for (const { e } of scored.toSorted((a, b) => b.s - a.s)) {
    if (out.length >= st.ctx.count) break;
    const item = acceptFile(e, st);
    if (item !== null) out.push(item);
  }
  return out;
}
async function llmQueries(st: State): Promise<string[]> {
  const apiKey = st.deps.openAiApiKey?.trim() ?? "";
  const llm =
    st.deps.llm ??
    (apiKey === "" ? undefined : getOrCreateVoiceDecisionsRuntime({ apiKey }));
  if (llm === undefined) {
    return [];
  }
  const seed = seedOf(st);
  const w = st.yt.slice(0, 6).map((c) => c.title);
  const parts = [
    seed ? `Seed: ${seed}` : "",
    w.length > 0 ? `Watched: ${w.join("; ")}` : "",
  ];
  const prompt =
    parts.filter(Boolean).join("\n") || "Video essays or short documentaries.";
  const system =
    "Suggest 3 watchable YouTube video queries (no music/topic audio/24-7 streams).";
  const abortSignal = AbortSignal.any([
    st.ctx.signal,
    AbortSignal.timeout(10_000),
  ]);
  try {
    const res = await generateValidatedObject(llm, {
      model: VOICE_DECISIONS_MODEL,
      workload: "streambot.tv.curate",
      schema: TvQueriesSchema,
      schemaName: "tv_video_queries",
      system,
      prompt,
      maxOutputTokens: 250,
      abortSignal,
    });
    return res.object.queries
      .map((q) => q.trim())
      .filter((q) => q.length >= 2 && q.length <= 120 && !isBlockedText(q))
      .slice(0, 3);
  } catch {
    return [];
  }
}
function resolveMixFn(deps: TvCuratorDeps) {
  if (deps.fetchMix !== undefined) return deps.fetchMix;
  const ytDlpPath = deps.ytDlpPath;
  return ytDlpPath === undefined
    ? undefined
    : (req: MixArg) => expandYoutubeMix({ ytDlpPath, ...req });
}
async function discoverYt(st: State): Promise<YtdlpSearchResult[]> {
  const seed = seedOf(st);
  const { signal } = st.ctx;
  const search = st.deps.searchYoutube ?? st.deps.discovery?.searchYoutube;
  const fetchMix = resolveMixFn(st.deps);
  const init =
    search === undefined || seed === "" ? [] : await search(seed, signal, 6);
  const disc = [...init];
  if (fetchMix !== undefined) {
    const rawIds = st.yt.map((r) => extractYoutubeVideoId(r.url) ?? "");
    for (const videoId of [...new Set(rawIds.filter(Boolean))].slice(0, 2)) {
      const req = { videoId, limit: 8, excludeIdentities: st.gate.ids, signal };
      disc.push(...(await fetchMix(req)));
    }
  }
  if (search === undefined) return disc;
  const ch =
    seed === "" ? st.yt.find((r) => Boolean(r.channel))?.channel : undefined;
  if (ch !== undefined) disc.push(...(await search(ch, signal, 4)));
  for (const q of await llmQueries(st))
    disc.push(...(await search(q, signal, 4)));
  return disc;
}
async function curateYoutube(st: State): Promise<Item[]> {
  const seed = seedOf(st);
  const disc = await discoverYt(st);
  const hist = st.yt.filter(
    (c) => seed === "" || hasSeed(seed, [c.title, c.channel]),
  );
  const pool = seed === "" ? [...disc, ...hist] : [...hist, ...disc];
  const out: Item[] = [];
  for (const { url, ...rest } of pool) {
    if (out.length >= st.ctx.count || !isWatchableYt({ url, ...rest }))
      continue;
    const item = st.gate.accept({
      ...rest,
      source: { kind: "url", url, title: rest.title },
    });
    if (item !== null) out.push(item);
  }
  return out;
}
function blendMix(lanes: Item[][], st: State): Item[] {
  const seed = seedOf(st);
  const matches = (x: Item) =>
    x.source.kind === "file"
      ? plexSeed(st, x.title, x.source.path)
      : hasSeed(seed, [x.title, x.channel]);
  const raw: Item[] = [];
  for (let i = 0; i < Math.max(st.ctx.count * 3, 10); i += 1) {
    const pick = lanes[MIX_SLOTS[i % 10] ?? 0]?.shift();
    if (pick !== undefined) raw.push(pick);
  }
  const ordered =
    seed === ""
      ? raw
      : raw.toSorted((a, b) => Number(!matches(a)) - Number(!matches(b)));
  const out: Item[] = [];
  for (const x of ordered) {
    if (out.length >= st.ctx.count) break;
    const item = st.gate.accept(x);
    if (item !== null) out.push(item);
  }
  return out;
}

export function createTvCurator(deps: TvCuratorDeps): StationCurator {
  return {
    curate: async (raw) => {
      const st = await buildState(deps, raw);
      const preset = st.ctx.station.tvPreset ?? "my-mix";
      if (preset === "continue-series") return curateContinueSeries(st);
      if (preset === "sitcoms") return curateSitcoms(st);
      if (preset === "movies") return curateMovies(st);
      if (preset === "youtube") return await curateYoutube(st);
      const ep = curateContinueSeries({ ...st, gate: createGate(st.ctx) });
      const mv = curateMovies({ ...st, gate: createGate(st.ctx) });
      const yt = await curateYoutube({ ...st, gate: createGate(st.ctx) });
      return blendMix([ep, mv, yt], st);
    },
  };
}
