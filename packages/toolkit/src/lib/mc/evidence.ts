import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { z } from "zod";
import type {
  EvidenceQuery,
  EvidencePageSchema,
} from "@shepherdjerred/mc-harness/protocol/evidence.ts";

export type EvidencePage = z.infer<typeof EvidencePageSchema>;

/** New owner-only files; never overwrite a previous export or print its private rows. */
export async function exportEvidence(
  query: EvidenceQuery,
  output: string,
  fetchPage: (query: EvidenceQuery) => Promise<EvidencePage>,
  target: string,
): Promise<number> {
  const file = await open(output, "wx", 0o600);
  try {
    await file.chmod(0o600);
    await file.write(
      `${JSON.stringify({
        kind: "manifest",
        version: 1,
        target,
        since: query.since,
        until: query.until,
        querySha256: createHash("sha256")
          .update(JSON.stringify(query))
          .digest("hex"),
      })}\n`,
    );
    let pageQuery = { ...query, limit: 1000 };
    let count = 0;
    let more = true;
    while (more) {
      const page = await fetchPage(pageQuery);
      for (const row of page.rows)
        await file.write(`${JSON.stringify({ ...row, kind: "submission" })}\n`);
      for (const event of page.events)
        await file.write(`${JSON.stringify({ ...event, kind: "event" })}\n`);
      count += page.rows.length;
      more = page.hasMore;
      if (more && page.next <= pageQuery.after)
        throw new Error("Evidence export cursor did not advance");
      pageQuery = { ...pageQuery, after: page.next };
    }
    await file.sync();
    return count;
  } finally {
    await file.close();
  }
}
