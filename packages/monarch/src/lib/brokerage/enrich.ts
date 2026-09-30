import path from "node:path";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import type { CashEvent, ShareSale } from "./types.ts";
import {
  parseBrokerageTransactionsCsv,
  parseRealizedGainLossCsv,
} from "./parser.ts";
import { matchBrokerageTransactions } from "./matcher.ts";
import { BROKERAGE_DIR, allVaultFiles } from "../finance-vault.ts";
import { log } from "../logger.ts";

export type BrokerageEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
};

// Schwab exports arrive under names of its choosing, and which file is which
// matters: one carries the cash movements, the other the cost basis. Rather
// than depend on a filename convention that the next download will not follow,
// each CSV is classified by what its own header says it is. Every file in the
// folder is read, so an older export still contributes the months a newer one
// no longer covers.
const REALIZED_HEADER = "Closed Date";
const TRANSACTIONS_HEADER = "Fees & Comm";

type Exports = { events: CashEvent[]; sales: ShareSale[] };

async function readExports(): Promise<Exports> {
  const files = allVaultFiles(BROKERAGE_DIR, "*.csv");
  const events: CashEvent[] = [];
  const sales: ShareSale[] = [];

  for (const file of files) {
    const text = await Bun.file(file).text();
    const head = text.slice(0, 2048);
    if (head.includes(REALIZED_HEADER)) {
      sales.push(...parseRealizedGainLossCsv(text));
    } else if (head.includes(TRANSACTIONS_HEADER)) {
      events.push(...parseBrokerageTransactionsCsv(text));
    } else {
      log.warn(
        `${path.basename(file)} in ${BROKERAGE_DIR} is neither a transaction history nor a realized gain/loss export; ignoring it`,
      );
    }
  }

  return { events: dedupe(events), sales: dedupeSales(sales) };
}

function dedupe(events: CashEvent[]): CashEvent[] {
  const seen = new Map<string, CashEvent>();
  for (const event of events) {
    seen.set(`${event.kind}|${event.date}|${event.amount.toFixed(2)}`, event);
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function dedupeSales(sales: ShareSale[]): ShareSale[] {
  const seen = new Map<string, ShareSale>();
  for (const sale of sales) {
    seen.set(
      `${sale.symbol}|${sale.soldDate}|${sale.proceeds.toFixed(2)}`,
      sale,
    );
  }
  return [...seen.values()].sort((a, b) =>
    a.soldDate.localeCompare(b.soldDate),
  );
}

export async function enrichBrokerage(
  brokerageTransactions: MonarchTransaction[],
): Promise<BrokerageEnrichResult> {
  const { events, sales } = await readExports();
  if (events.length === 0) {
    throw new Error(
      `No brokerage cash movements parsed from ${BROKERAGE_DIR}. Export Transaction History and Realized Gain/Loss as CSV from the brokerage account, or pass --skip-brokerage`,
    );
  }

  const result = matchBrokerageTransactions(
    brokerageTransactions,
    events,
    sales,
  );
  log.info(
    `Matched ${String(result.matched.length)}/${String(brokerageTransactions.length)} brokerage transactions to ${String(events.length)} cash movements (${String(sales.length)} sales on file)`,
  );

  const unfunded = result.matched.filter(
    (m) => m.funded.event.kind === "transfer" && m.funded.sale === undefined,
  );
  if (unfunded.length > 0) {
    log.info(
      `${String(unfunded.length)} transfers have no sale on file to explain them (${unfunded
        .map((m) => m.transaction.date)
        .join(", ")})`,
    );
  }

  const enrichments = new Map<string, TransactionEnrichment>();
  for (const { transaction, funded } of result.matched) {
    const { sale } = funded;
    enrichments.set(transaction.id, {
      brokerage: {
        kind: funded.event.kind,
        ...(sale === undefined
          ? {}
          : {
              symbol: sale.symbol,
              soldDate: sale.soldDate,
              quantity: sale.quantity,
              price: sale.price,
              proceeds: sale.proceeds,
              costBasis: sale.costBasis,
              gainLoss: sale.gainLoss,
            }),
        cashSwept: funded.cashSwept,
      },
      enrichmentSource: "brokerage",
    });
  }

  return {
    enrichments,
    matchRate: {
      matched: result.matched.length,
      total: brokerageTransactions.length,
    },
  };
}
