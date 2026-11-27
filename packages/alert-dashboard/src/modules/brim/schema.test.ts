import { describe, expect, it } from "vitest";

import {
  HistoryBlocksSchema,
  HistoryCaptureDetailSchema,
  HistoryCapturesSchema,
  HistoryFacetsSchema,
  HistorySessionDetailSchema,
  HistorySessionsSchema,
  UsageReportSchema,
} from "./schema.ts";

const projections = {
  blocks: HistoryBlocksSchema,
  "capture-detail": HistoryCaptureDetailSchema,
  captures: HistoryCapturesSchema,
  facets: HistoryFacetsSchema,
  sessions: HistorySessionsSchema,
  "session-detail": HistorySessionDetailSchema,
  "usage-report": UsageReportSchema,
};

describe("Brim history projections", () => {
  for (const [name, schema] of Object.entries(projections)) {
    it(`reads toolkit's ${name} fixture`, async () => {
      const path = new URL(
        `../../../../toolkit/schemas/fixtures/history-api-${name}.json`,
        import.meta.url,
      );
      const input: unknown = await Bun.file(path).json();
      expect(schema.safeParse(input).success).toBe(true);
    });
  }
});
