import { expect, test } from "vitest";
import {
  AvistazFamilyProvider,
  KnabenProvider,
  PirateBayProvider,
  type ProviderCandidate,
} from "./providers.ts";
import { MagnetDownloadProvider } from "./magnetdownload.ts";
import { StoredCandidateSchema } from "#automation/providers.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";

const hash = "a".repeat(40);
const providers = [
  "knaben",
  "thepiratebay",
  "magnetdownload",
  "privatehd",
  "avistaz",
  "animez",
] as const;
const family = ["privatehd", "avistaz", "animez"] as const;

async function search(
  providerId: ProviderCandidate["providerId"],
  primary: string,
  secondary?: string | null,
) {
  const query = { query: "Fixture", kind: "movie" as const };
  if (providerId === "knaben")
    return new KnabenProvider(async () =>
      Response.json({
        hits: [
          {
            id: "42",
            title: primary,
            bytes: 1024,
            hash,
            seeders: 1,
            details: "https://knaben.org/fixture",
            magnetUrl: null,
          },
        ],
      }),
    ).search(query);
  if (providerId === "thepiratebay")
    return new PirateBayProvider(async () =>
      Response.json([
        { id: "42", name: primary, info_hash: hash, size: 1024, seeders: 1 },
      ]),
    ).search(query);
  if (providerId === "magnetdownload") {
    const encoded = primary.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const client = new MagnetDownloadProvider(async (url) =>
      url.pathname === "/api/json_info"
        ? Response.json({ items: [{ hash }] })
        : new Response(
            `<table><tr><td class="x-item"><a href="/info/42" title="${encoded}">Display title ignored</a><div class="tail">size: 1 KiB</div></td></tr></table>`,
          ),
    );
    const rows = await client.search(query.query);
    const row = rows[0];
    if (row === undefined) throw new Error("Missing fixture search row");
    return [await client.resolve(row)];
  }
  const client = new AvistazFamilyProvider(
    { providerId, username: "fixture", password: "fixture", pid: "fixture" },
    async (url) =>
      url.pathname.endsWith("auth")
        ? Response.json({ token: "fixture-session" })
        : Response.json({
            data: [
              {
                url: `https://${providerId}.to/torrent/42`,
                download: `https://${providerId}.to/download/42?token=fixture`,
                file_name: primary,
                release_title: secondary,
                info_hash: hash,
                file_size: 1024,
                seed: 1,
              },
            ],
          }),
  );
  await client.login();
  return client.search(query);
}

function evidence(field: string, text: string) {
  return { text, provenance: { kind: "release-title", field } };
}

test.each(providers)(
  "%s retains exact attributed primary text through existing JSON schemas",
  async (providerId) => {
    const text = '  Fixture & Film — "Final Cut"  ';
    const rows = await search(providerId, text);
    const row = rows[0];
    expect(row?.title).toBe(text);
    expect(row).not.toHaveProperty("references");
    const field =
      providerId === "knaben"
        ? "title"
        : providerId === "thepiratebay"
          ? "name"
          : providerId === "magnetdownload"
            ? "search.infoAnchor.title"
            : "file_name";
    const expected = [evidence(field, text)];
    expect(row?.editionEvidence).toEqual(expected);
    const serialized = JSON.stringify(row);
    const stored = StoredCandidateSchema.parse(JSON.parse(serialized));
    expect(stored.editionEvidence).toEqual(expected);
    expect(
      CandidateSourceEvidenceSchema.parse({
        infoHash: stored.infoHash,
        editionEvidence: stored.editionEvidence,
      }).editionEvidence,
    ).toEqual(expected);
  },
);

test.each(family)(
  "%s retains equal and contradictory family fields without changing display preference",
  async (providerId) => {
    const primary = "Fixture.2020.Theatrical.Cut.mkv";
    for (const secondary of [primary, " Fixture.2020.Director's.Cut "]) {
      const rows = await search(providerId, primary, secondary);
      expect(rows[0]?.title).toBe(
        providerId === "animez" ? secondary : primary,
      );
      expect(rows[0]?.editionEvidence).toEqual([
        evidence("file_name", primary),
        evidence("release_title", secondary),
      ]);
    }
  },
);

test.each(family)(
  "%s omits only null, absent and empty fields, preserving whitespace",
  async (providerId) => {
    for (const secondary of [undefined, null, ""]) {
      const rows = await search(providerId, "Fixture", secondary);
      expect(rows[0]?.title).toBe("Fixture");
      expect(rows[0]?.editionEvidence).toEqual([
        evidence("file_name", "Fixture"),
      ]);
    }
    const rows = await search(providerId, "", "  ");
    expect(rows[0]?.title).toBe(providerId === "animez" ? "  " : "");
    expect(rows[0]?.editionEvidence).toEqual([evidence("release_title", "  ")]);
  },
);

test.each(providers)(
  "%s accepts the exact title bound and rejects an oversized suffix without truncation",
  async (providerId) => {
    const text = "x".repeat(500);
    const rows = await search(providerId, text);
    expect(rows[0]?.editionEvidence?.[0]?.text).toBe(text);
    await expect(search(providerId, `${text} Director's Cut`)).rejects.toThrow(
      "invalid-response",
    );
  },
);

test.each(family)(
  "%s rejects an oversized secondary title even when it is not the display title",
  async (providerId) => {
    await expect(
      search(providerId, "Fixture", `${"x".repeat(500)} Extended Cut`),
    ).rejects.toThrow("invalid-response");
  },
);
