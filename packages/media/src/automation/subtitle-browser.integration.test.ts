import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { CredentialCipher } from "#application/security.ts";
import { IntegrationError } from "#integrations/http.ts";
import { fromSubhd } from "./subtitle-browser-sources.ts";
import {
  cleanupSubtitleBrowser,
  readBrowserState,
} from "./subtitle-browser-lifecycle.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
});
async function fixture() {
  const operation = await cluster.database.operation.create({
    data: {
      kind: "find_subtitles",
      payload: {},
      result: { retained: "journal" },
    },
  });
  const context = { db: cluster.database, cipher };
  const input = {
    operationId: operation.id,
    sourceFilename: "Film.2020.1080p.mkv",
    query: "Film",
    language: "zh-Hans",
  };
  const browser = {
    openSubhd: vi.fn(async () => "owned-tab"),
    prepareSubhd: vi.fn(
      async (): Promise<"loading" | "prepared"> => "prepared",
    ),
    resolveSubhd: vi.fn(
      async (
        _tabId: string,
        _subtitleId: string,
        _signal?: AbortSignal,
        beforeDownload?: () => Promise<void>,
      ): Promise<{ status: "loading" } | { status: "ready"; url: string }> => {
        await beforeDownload?.();
        throw new IntegrationError("subhd", "outcome-unknown");
      },
    ),
    close: vi.fn(async () => {
      /* The fixture confirms this exact owned tab closed. */
    }),
  };
  const provider = {
    search: async () => [
      {
        id: "abc",
        release: "Film.2020.1080p.srt",
        pageUrl: "https://subhd.tv/a/abc",
        provenance: "original" as const,
        simplifiedLabel: true,
      },
    ],
    downloadAuthorized: async (): Promise<Uint8Array<ArrayBuffer>> => {
      throw new Error("Fixture must not download");
    },
  };
  return { context, input, browser, provider };
}

test("challenge closes the exact owned tab and preserves durable intervention and other journal fields", async () => {
  const item = await fixture();
  item.browser.prepareSubhd.mockRejectedValue(
    new IntegrationError("subhd", "interaction-required"),
  );
  await expect(fromSubhd(item.context, item.input, item)).rejects.toMatchObject(
    { kind: "interaction-required" },
  );
  expect(item.browser.close).toHaveBeenCalledWith("owned-tab");
  expect(
    await readBrowserState(item.context, item.input.operationId),
  ).toMatchObject({ phase: "closed" });
  const operation = await cluster.database.operation.findUniqueOrThrow({
    where: { id: item.input.operationId },
  });
  expect(operation.result).toMatchObject({ retained: "journal" });
  await expect(fromSubhd(item.context, item.input, item)).rejects.toMatchObject(
    { kind: "interaction-required" },
  );
  expect(item.browser.openSubhd).toHaveBeenCalledTimes(1);
});
test("a lost download response retains the quota claim and closes the tab without replay", async () => {
  const item = await fixture();
  await expect(fromSubhd(item.context, item.input, item)).resolves.toEqual({
    pending: true,
  });
  await expect(fromSubhd(item.context, item.input, item)).rejects.toMatchObject(
    { kind: "outcome-unknown" },
  );
  const operation = await cluster.database.operation.findUniqueOrThrow({
    where: { id: item.input.operationId },
  });
  expect(operation.result).toMatchObject({
    retained: "journal",
    subtitleDownload: { providerId: "subhd", candidateId: "abc" },
    subtitleBrowser: { phase: "closed" },
  });
  expect(item.browser.close).toHaveBeenCalledTimes(1);
});
test("terminal cancellation closes a pending tab; failed close remains retriable and visible", async () => {
  const item = await fixture();
  item.browser.prepareSubhd.mockResolvedValue("loading");
  await expect(fromSubhd(item.context, item.input, item)).resolves.toEqual({
    pending: true,
  });
  item.browser.close.mockRejectedValueOnce(new Error("lost close response"));
  await expect(
    cleanupSubtitleBrowser(
      item.context,
      item.input.operationId,
      "cancelled",
      item.browser,
    ),
  ).rejects.toMatchObject({ kind: "outcome-unknown" });
  expect(
    await readBrowserState(item.context, item.input.operationId),
  ).toMatchObject({ phase: "close_unknown" });
  await cleanupSubtitleBrowser(
    item.context,
    item.input.operationId,
    "cancelled",
    item.browser,
  );
  expect(
    await readBrowserState(item.context, item.input.operationId),
  ).toMatchObject({ phase: "closed", reason: "cancelled" });
});
test("lost tab creation never blindly creates another browser tab", async () => {
  const item = await fixture();
  item.browser.openSubhd.mockRejectedValue(
    new IntegrationError("subtitle-browser", "outcome-unknown"),
  );
  await expect(fromSubhd(item.context, item.input, item)).rejects.toMatchObject(
    { kind: "outcome-unknown" },
  );
  await expect(
    cleanupSubtitleBrowser(
      item.context,
      item.input.operationId,
      "failed",
      item.browser,
    ),
  ).rejects.toMatchObject({ kind: "outcome-unknown" });
  expect(
    await readBrowserState(item.context, item.input.operationId),
  ).toMatchObject({ phase: "open_unknown", tabId: null });
  await expect(fromSubhd(item.context, item.input, item)).rejects.toMatchObject(
    { kind: "outcome-unknown" },
  );
  expect(item.browser.openSubhd).toHaveBeenCalledTimes(1);
});
