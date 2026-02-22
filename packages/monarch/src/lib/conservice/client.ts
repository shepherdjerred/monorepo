import { z } from "zod";
import path from "node:path";
import { homedir } from "node:os";
import { log } from "../logger.ts";
import type { ConserviceCharge } from "./types.ts";

const CONSERVICE_URL =
  "https://utilitiesinfo.conservice.com/Tenant/GetHistoricalChargesForTenant";

const ConserviceApiSchema = z.object({
  Data: z.array(
    z.object({
      RowNumber: z.number(),
      Description: z.string(),
      ChargeAmount: z.number(),
      PaymentAmount: z.number(),
      Balance: z.number(),
      MonthTotal: z.number(),
      PostMonth: z.string(),
      TransactionDate: z.string(),
      ChargeTypeID: z.number(),
    }),
  ),
  Total: z.number(),
});

const CACHE_DIR = path.join(homedir(), ".monarch-cache");
const CACHE_FILE = path.join(CACHE_DIR, "conservice.json");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const CacheSchema = z.object({
  cachedAt: z.string(),
  charges: z.array(
    z.object({
      rowNumber: z.number(),
      description: z.string(),
      chargeAmount: z.number(),
      paymentAmount: z.number(),
      monthTotal: z.number(),
      postMonth: z.string(),
      transactionDate: z.string(),
      chargeTypeId: z.number(),
    }),
  ),
});

export function parseNetDate(dateString: string): string {
  const match = /\\?\/Date\((\d+)\)\\?\//.exec(dateString);
  const timestamp = match?.[1];
  if (timestamp === undefined || timestamp === "") {
    throw new Error(`Invalid .NET date string: ${dateString}`);
  }
  return new Date(Number(timestamp)).toISOString().split("T")[0] ?? dateString;
}

async function loadCache(): Promise<ConserviceCharge[] | null> {
  const file = Bun.file(CACHE_FILE);
  if (!(await file.exists())) return null;

  const raw: unknown = await file.json();
  const parsed = CacheSchema.parse(raw);
  const age = Date.now() - new Date(parsed.cachedAt).getTime();

  if (age > CACHE_MAX_AGE_MS) {
    log.info("Conservice cache expired, will re-fetch");
    return null;
  }

  log.info(
    `Loaded ${String(parsed.charges.length)} Conservice charges from cache (${String(Math.round(age / 60_000))}m old)`,
  );
  return parsed.charges;
}

async function saveCache(charges: ConserviceCharge[]): Promise<void> {
  await Bun.write(
    CACHE_FILE,
    JSON.stringify(
      { cachedAt: new Date().toISOString(), charges },
      null,
      2,
    ),
  );
  log.info(`Cached ${String(charges.length)} Conservice charges`);
}

export async function fetchConserviceCharges(
  cookies: string,
): Promise<ConserviceCharge[]> {
  const cached = await loadCache();
  if (cached) return cached;

  const allCharges: ConserviceCharge[] = [];
  const pageSize = 200;
  let skip = 0;
  let total = Infinity;

  while (skip < total) {
    const body = new URLSearchParams({
      sort: "",
      page: String(Math.floor(skip / pageSize) + 1),
      pageSize: String(pageSize),
      group: "",
      filter: "",
      startDate: "",
      endDate: "",
      showAll: "",
    });

    const response = await fetch(CONSERVICE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: cookies,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(
        `Conservice API error: ${String(response.status)} ${response.statusText}`,
      );
    }

    const raw: unknown = await response.json();
    const parsed = ConserviceApiSchema.parse(raw);
    total = parsed.Total;

    for (const record of parsed.Data) {
      allCharges.push({
        rowNumber: record.RowNumber,
        description: record.Description,
        chargeAmount: record.ChargeAmount,
        paymentAmount: record.PaymentAmount,
        monthTotal: record.MonthTotal,
        postMonth: parseNetDate(record.PostMonth),
        transactionDate: parseNetDate(record.TransactionDate),
        chargeTypeId: record.ChargeTypeID,
      });
    }

    skip += pageSize;

    if (parsed.Data.length < pageSize) break;
  }

  log.info(`Fetched ${String(allCharges.length)} Conservice charges`);
  await saveCache(allCharges);
  return allCharges;
}
