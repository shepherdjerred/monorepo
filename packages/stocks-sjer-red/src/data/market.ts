import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const CACHE_PATH = ".cache/market.json";
const TTL_MS = 60 * 60 * 1000;

const SYMBOLS = [
  { symbol: "MU", name: "Micron" },
  { symbol: "NVDA", name: "Nvidia" },
  { symbol: "AMD", name: "AMD" },
  { symbol: "INTC", name: "Intel" },
  { symbol: "TSM", name: "TSMC" },
  { symbol: "AVGO", name: "Broadcom" },
  { symbol: "ASML", name: "ASML" },
  { symbol: "SMCI", name: "Supermicro" },
  { symbol: "WDC", name: "Western Digital" },
  { symbol: "STX", name: "Seagate" },
  { symbol: "LRCX", name: "Lam Research" },
  { symbol: "AMAT", name: "Applied Materials" },
] as const;

const ChartResponseSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            symbol: z.string(),
            regularMarketPrice: z.number(),
            chartPreviousClose: z.number(),
            regularMarketTime: z.number(),
          }),
        }),
      )
      .min(1),
    error: z.null().optional(),
  }),
});

const QuoteSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  price: z.number(),
  prevClose: z.number(),
  changePct: z.number(),
  asOf: z.string(),
});

const CacheSchema = z.object({
  fetchedAt: z.string(),
  quotes: z.array(QuoteSchema),
});

export type Quote = z.infer<typeof QuoteSchema>;

async function fetchOne(symbol: string, name: string): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`yahoo ${symbol} HTTP ${String(res.status)}`);
  }
  const parsed = ChartResponseSchema.parse(await res.json());
  const meta = parsed.chart.result[0]?.meta;
  if (!meta) throw new Error(`yahoo ${symbol} no result`);
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose;
  const asOf = new Date(meta.regularMarketTime * 1000).toISOString();
  return {
    symbol,
    name,
    price,
    prevClose: prev,
    changePct: ((price - prev) / prev) * 100,
    asOf,
  };
}

function isFileNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function readCache(): Promise<Quote[] | null> {
  try {
    const raw = await readFile(CACHE_PATH, "utf-8");
    const parsed = CacheSchema.parse(JSON.parse(raw));
    return parsed.quotes;
  } catch (err) {
    if (!isFileNotFound(err)) {
      console.warn(
        "[market] cache read error:",
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }
}

async function writeCache(quotes: Quote[]): Promise<void> {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  const payload = { fetchedAt: new Date().toISOString(), quotes };
  await writeFile(CACHE_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

async function isCacheFresh(): Promise<boolean> {
  try {
    const raw = await readFile(CACHE_PATH, "utf-8");
    const parsed = CacheSchema.parse(JSON.parse(raw));
    return Date.now() - Date.parse(parsed.fetchedAt) < TTL_MS;
  } catch (err) {
    if (!isFileNotFound(err)) {
      console.warn(
        "[market] cache freshness check error:",
        err instanceof Error ? err.message : String(err),
      );
    }
    return false;
  }
}

let inflight: Promise<Quote[]> | null = null;

export function fetchQuotes(): Promise<Quote[]> {
  inflight ??= load().catch((err: unknown) => {
    // Clear the cached rejection so the next call retries; without this,
    // a single failed load would poison every subsequent fetchQuotes()
    // call for the lifetime of the process.
    inflight = null;
    throw err;
  });
  return inflight;
}

async function load(): Promise<Quote[]> {
  if (await isCacheFresh()) {
    const cached = await readCache();
    if (cached) return cached;
  }
  try {
    const fresh = await Promise.all(
      SYMBOLS.map((s) => fetchOne(s.symbol, s.name)),
    );
    await writeCache(fresh);
    return fresh;
  } catch (err) {
    const stale = await readCache();
    if (stale) {
      console.warn(
        "[market] fetch failed, serving stale cache:",
        err instanceof Error ? err.message : String(err),
      );
      return stale;
    }
    throw err;
  }
}
