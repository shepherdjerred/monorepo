# Monarch Match Rate Fixes

## Status

Not Started. Diagnosis from `bun run src/index.ts` on 2026-04-25.

## Context

Enrichment match rates from a recent run:

| Enricher | Matched         | Why                                     |
| -------- | --------------- | --------------------------------------- |
| Amazon   | 169 / 328 (52%) | partial — structural + scraper timeouts |
| Bilt     | 0 / 48 (0%)     | input directory missing                 |
| USAA     | 0 / 18 (0%)     | input directory missing                 |
| Apple    | 0 / 31 (0%)     | 5 receipts parsed, 0 matched — real bug |
| Costco   | 0 / 24 (0%)     | input file missing                      |

Three of the zeros (Bilt, USAA, Costco) are missing input files — not bugs. Apple parsing 5 receipts but matching 0 is a real bug. Amazon's 52% is partly structural and partly scraper flakiness.

## Missing input data (user action)

| Integration       | Path                                                 | Format                                        |
| ----------------- | ---------------------------------------------------- | --------------------------------------------- |
| Bilt / Conservice | `packages/monarch/data/conservice/`                  | `ConserviceBill*.pdf`                         |
| USAA              | `packages/monarch/data/usaa/`                        | `*_Auto_and_Property_Insurance_Statement.pdf` |
| Costco            | `packages/monarch/src/lib/costco/costco-orders.json` | JSON array of orders                          |

Source references:

- `packages/monarch/src/lib/conservice/parser.ts:7-14`
- `packages/monarch/src/lib/usaa/parser.ts:7-14`
- `packages/monarch/src/lib/costco/scraper.ts:26-29`

## Apple — root-cause hypotheses

Matcher (`src/lib/apple/matcher.ts:25-44`) requires `daysDiff ≤ 3` AND `|txnAmount - receipt.total| ≤ 0.01`. With 5 parsed receipts vs 31 candidate txns, ≥ 1 match should occur. Ranked culprits:

1. **`/TOTAL:/i` overmatches `SUBTOTAL:`** (`src/lib/apple/parser.ts:61`). No word boundary, so on a receipt with both `SUBTOTAL: $9.99` and `TOTAL: $10.84`, the regex can match the substring inside `SUBTOTAL:` first. Result: `receipt.total` = pre-tax subtotal, never matches the post-tax txn amount.
2. **HTML-only receipts**. Modern Apple email receipts are increasingly HTML-only. `extractPlainTextBody` (`parser.ts:31-52`) returns the email body when no `text/plain` part exists, but the `ORDER ID:` / `TOTAL:` labels may be missing, leading to `total = 0` (silently swallowed by `?? 0` in `parser.ts:65-67`).
3. **Currency / locale**. Non-USD receipts could parse a different number format.

Date parsing is **not** a likely cause: `parseAppleDate` returns the unparsed string on failure, `new Date("...")` yields `NaN`, but `NaN > 3` is `false` so a bad date would _let_ matches through, not block them.

The parser tests (`parser.test.ts`) only cover the happy-path plain-text format and won't catch any of these.

## Amazon — 52% gap, ranked

1. **Per-shipment charges**. Amazon charges per shipment, not per order. A $100 order shipped in two boxes = two txns ($40 + $60); neither matches the $100 order total.
2. **Scraper timeouts**. Multiple `Failed to extract order summary: Timeout 30000ms` warnings in the log. Each = a missing order = an unmatchable txn.
3. **Refunds / partial refunds**. Refund txns become positive after `Math.abs`; no scraped "refund" record exists.
4. **Gift cards / promo credits**. Order total includes line-item prices but txn is reduced by promotional credits.

## Recommended approach

### Phase 1 — diagnose Apple (small, no behavior change)

Add `--verbose`-gated logging in `src/lib/apple/enrich.ts` before the enrichment loop showing each parsed receipt's `(orderId, date, total, items.length)` and unmatched candidate txns' `(date, amount)`. One run with `--verbose --skip-amazon --skip-research` will reveal which hypothesis is correct.

### Phase 2 — fix Apple parser

Assuming hypothesis #1 confirms:

- `src/lib/apple/parser.ts:61` — anchor the TOTAL regex: `/^TOTAL:\s*\$?([\d,.]+)/im` (multiline + start anchor).
- `src/lib/apple/parser.ts:65-67` — `?? 0` is a silent failure. If `totalMatch` is null, log a warning and return `null` from `parseAppleReceipt` so we don't produce ghost zero-total receipts.
- Add a parser test fixture exercising SUBTOTAL/TAX/TOTAL ordering.

If hypothesis #2 (HTML-only) confirms instead, add an HTML extraction path (parse the table rows for the receipt fields, or fall back to stripping HTML tags before re-running the existing regexes).

### Phase 3 — relax Amazon matching for shipments

- **Subset-sum match for multi-shipment orders** (`src/lib/amazon/matcher.ts`): if a single txn doesn't match `order.total` but matches a sum of consecutive items in `order.items` (within $0.02), accept the match and remember consumed items so other shipments of the same order match the remainder.
- Keep the date window at ±3 days.
- **Refund matching** is out of scope for this plan — would require scraper changes to track refunds.

Expected lift: 52% → ~65–75%.

### Phase 4 — surface missing inputs

Promote the scattered `[WARN]` lines for missing Conservice/USAA/Costco input directories into a single end-of-enrichment summary block in `src/lib/enrichment.ts` so the user sees exactly what's missing and where to put it.

## Critical files

| File                                              | Phase | What changes                                     |
| ------------------------------------------------- | ----- | ------------------------------------------------ |
| `packages/monarch/src/lib/apple/enrich.ts`        | 1     | verbose diagnostic logging                       |
| `packages/monarch/src/lib/apple/parser.ts`        | 2     | anchored TOTAL regex; fail-loud on missing total |
| `packages/monarch/src/lib/apple/parser.test.ts`   | 2     | SUBTOTAL/TAX/TOTAL fixture                       |
| `packages/monarch/src/lib/amazon/matcher.ts`      | 3     | subset-sum multi-shipment match                  |
| `packages/monarch/src/lib/amazon/matcher.test.ts` | 3     | multi-shipment fixture                           |
| `packages/monarch/src/lib/enrichment.ts`          | 4     | consolidated missing-input summary               |

## Verification

1. `bun test src/lib/apple/parser.test.ts` — passes including new SUBTOTAL fixture.
2. `bun run src/index.ts --verbose --skip-amazon --skip-research` — Apple match rate goes from 0/31 to ≥ 5/31.
3. `bun test src/lib/amazon/matcher.test.ts` — passes. Full pipeline run shows Amazon ≥ 65%.
4. `bun run typecheck` and `bunx eslint .` in `packages/monarch` — green.
5. After dropping Bilt / USAA / Costco files in the documented paths, those rates go above 0%.

## Open questions

1. Are Bilt / USAA / Costco files actually somewhere else on disk? If yes, make paths configurable.
2. Phase 1 diagnostic-first, or skip straight to Phase 2 fix on the strongest hypothesis?
3. Is +13pp on Amazon worth the matcher complexity, or skip Phase 3?
