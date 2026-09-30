import type {
  ConserviceCharge,
  ConserviceMonthSummary,
  BiltMatch,
  BiltSplit,
} from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

const RENT_TYPES = new Set([19, 137, 4, 1132]);
const PET_TYPES = new Set([112]);
const WATER_SEWER_TYPES = new Set([1, 2, 8, 30, 677, 612, 613]);
const ELECTRIC_TYPES = new Set([6, 32, 38, 163]);
const TRASH_TYPES = new Set([3, 1553, 616]);

function categorizeCharge(charge: ConserviceCharge): string {
  if (RENT_TYPES.has(charge.chargeTypeId)) return "rent";
  if (PET_TYPES.has(charge.chargeTypeId)) return "pets";
  if (WATER_SEWER_TYPES.has(charge.chargeTypeId)) return "waterSewer";
  if (ELECTRIC_TYPES.has(charge.chargeTypeId)) return "electric";
  return TRASH_TYPES.has(charge.chargeTypeId) ? "trash" : "rent";
}

// One summary per bill. Grouping by calendar month instead would merge a
// move-out final statement into that month's regular bill and report their sum
// as the amount due, which no single payment can match.
export function groupByMonth(
  charges: ConserviceCharge[],
): ConserviceMonthSummary[] {
  const billMap = new Map<string, ConserviceCharge[]>();

  for (const charge of charges) {
    const existing = billMap.get(charge.billId);
    if (existing) {
      existing.push(charge);
    } else {
      billMap.set(charge.billId, [charge]);
    }
  }

  const summaries: ConserviceMonthSummary[] = [];

  for (const [billId, monthCharges] of billMap) {
    const month = (monthCharges[0]?.postMonth ?? billId).slice(0, 7);
    let rent = 0;
    let pets = 0;
    let waterSewer = 0;
    let electric = 0;
    let trash = 0;

    for (const charge of monthCharges) {
      const category = categorizeCharge(charge);
      const amount = charge.chargeAmount;
      switch (category) {
        case "rent": {
          rent += amount;
          break;
        }
        case "pets": {
          pets += amount;
          break;
        }
        case "waterSewer": {
          waterSewer += amount;
          break;
        }
        case "electric": {
          electric += amount;
          break;
        }
        case "trash": {
          trash += amount;
          break;
        }
        // No default
      }
    }

    const monthTotal = monthCharges.find((c) => c.monthTotal > 0)?.monthTotal;
    const total = monthTotal ?? rent + pets + waterSewer + electric + trash;

    summaries.push({
      billId,
      month,
      total,
      rent,
      pets,
      waterSewer,
      electric,
      trash,
      charges: monthCharges,
    });
  }

  summaries.sort((a, b) => a.billId.localeCompare(b.billId));
  return summaries;
}

const CATEGORY_MAP: Record<string, string> = {
  rent: "Rent",
  pets: "Pets",
  waterSewer: "Water",
  electric: "Gas & Electric",
  trash: "Utilities",
};

export function matchBiltTransactions(
  monarchTxns: MonarchTransaction[],
  months: ConserviceMonthSummary[],
): BiltMatch[] {
  const eligible = monarchTxns.filter((t) => !t.isSplitTransaction);
  const matches: BiltMatch[] = [];
  // One bill documents one payment. Two bills can now survive in the same
  // month, and within the $1 tolerance both transactions would otherwise take
  // the first one's breakdown while the second bill went unused.
  const usedBillIds = new Set<string>();

  for (const txn of eligible) {
    const txnMonth = txn.date.slice(0, 7);
    const txnAmount = Math.abs(txn.amount);

    for (const month of months) {
      if (usedBillIds.has(month.billId)) continue;
      if (txnMonth !== month.month) continue;
      if (Math.abs(txnAmount - month.total) > 1) continue;

      const splits: BiltSplit[] = [];
      const fields = [
        "rent",
        "pets",
        "waterSewer",
        "electric",
        "trash",
      ] as const;

      for (const field of fields) {
        if (month[field] > 0) {
          splits.push({
            category: CATEGORY_MAP[field] ?? field,
            amount: month[field],
          });
        }
      }

      matches.push({
        monarchTransaction: txn,
        month,
        splits,
      });
      usedBillIds.add(month.billId);
      break;
    }
  }

  return matches;
}
