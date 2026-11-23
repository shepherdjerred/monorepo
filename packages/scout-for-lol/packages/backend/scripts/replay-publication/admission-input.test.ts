import { expect, test } from "vitest";
import { ReplayRenderPackageAdmissionSchema } from "@scout-for-lol/domain/artifacts/replay-support.ts";
import {
  validateReplayComparisonReport,
  verifyPublishedReplayPackage,
  verifyReplayAdmissionInputs,
} from "./admission-input.ts";

const hash = (text: string) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");
const gameBuild = "16.23.840.6595";
const protocol = "a".repeat(16);
const rosterInventorySha256 = "b".repeat(64);
const referenceCaptureSha256 = "c".repeat(64);
const result = "perceptual-equivalence";
const coverage = "whole-match-visual-audio-and-spectator-controls";
const script =
  "// Synthetic byte-verification fixture. This is never executed.\n";
const entrypoint = "engine.mjs";
const jsMime = "text/javascript;charset=utf-8";
const cache = "public, max-age=31536000, immutable";

type Options = {
  reportResult?: string;
  reportCoverage?: string;
  reportProtocol?: string;
  servedScript?: string;
  servedManifest?: string;
  servedReport?: string;
  reportMissing?: boolean;
  scriptMime?: string;
  cacheControl?: string;
  redirect?: boolean;
};

function fixture(options: Options = {}) {
  const scriptMember = {
    path: entrypoint,
    bytes: script.length,
    sha256: hash(script),
  };
  const manifestJson = `${JSON.stringify(
    {
      schemaVersion: 1,
      gameBuild,
      protocol,
      entrypoint,
      capabilities: {
        mapId: 11,
        gameMode: "CLASSIC",
        teamSizes: [5, 5],
        rosterCoverage: "all-legal-lineups-and-skins",
        rosterInventorySha256,
      },
      files: [scriptMember],
    },
    null,
    2,
  )}\n`;
  const manifestSha256 = hash(manifestJson);
  const prefix = `replay-assets/${gameBuild}/${manifestSha256}`;
  const manifestKey = `${prefix}/manifest.json`;
  const scriptKey = `${prefix}/${entrypoint}`;
  // These literals are synthetic trust-input samples, not visual test results.
  const summary = {
    schemaVersion: 1,
    gameBuild,
    protocol: options.reportProtocol ?? protocol,
    manifestSha256,
    rosterInventorySha256,
    referenceCaptureSha256,
    result: options.reportResult ?? result,
    coverage: options.reportCoverage ?? coverage,
  };
  const detailedReport = { ...summary, measurements: { fixtureOnly: true } };
  const reportText = JSON.stringify(detailedReport);
  const reportSha256 = hash(reportText);
  const reportPath = `/replay-evidence/${reportSha256}/report.json`;
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      requests.push(pathname);
      const response = (text: string, contentType: string) =>
        new Response(text, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": options.cacheControl ?? cache,
          },
        });
      if (pathname === `/${manifestKey}`)
        return response(
          options.servedManifest ?? manifestJson,
          "application/json",
        );
      if (pathname === `/${scriptKey}`) {
        if (options.redirect === true)
          return new Response(null, {
            status: 302,
            headers: { Location: reportPath },
          });
        return response(
          options.servedScript ?? script,
          options.scriptMime ?? jsMime,
        );
      }
      return pathname === reportPath && options.reportMissing !== true
        ? response(options.servedReport ?? reportText, "application/json")
        : new Response(null, { status: 404 });
    },
  });
  const stage = "beta" as const;
  const bucket = "synthetic-beta";
  const origin = server.url;
  const publication = {
    outcome: "published",
    stage,
    bucket,
    origin: origin.origin,
    archiveDigest: `sha256:${"d".repeat(64)}`,
    gameBuild,
    protocol,
    manifestSha256,
    manifestUrl: new URL(manifestKey, origin).href,
    objects: [
      {
        key: scriptKey,
        bytes: scriptMember.bytes,
        sha256: scriptMember.sha256,
        contentType: jsMime,
      },
      {
        key: manifestKey,
        bytes: manifestJson.length,
        sha256: manifestSha256,
        contentType: "application/json",
      },
    ],
  };
  const admission = {
    schemaVersion: 1,
    manifestSha256,
    rosterInventorySha256,
    nativeComparison: {
      gameBuild,
      reportPath,
      reportSha256,
      referenceCaptureSha256,
      result,
      coverage,
    },
  };
  return {
    input: { origin, bucket, stage, publication, admission },
    server,
    requests,
    manifestJson,
    manifestKey,
    scriptKey,
    reportPath,
    summary,
    detailedReport,
  };
}

test("verifies exact public bytes and returns the unmodified reviewed manifest and admission", async () => {
  const {
    input,
    server,
    requests,
    manifestJson,
    manifestKey,
    scriptKey,
    reportPath,
  } = fixture();
  try {
    await expect(verifyReplayAdmissionInputs(input)).resolves.toEqual({
      gameBuild,
      protocol,
      manifestSha256: input.publication.manifestSha256,
      manifestPath: `/${manifestKey}`,
      manifestJson,
      admissionJson: input.admission,
    });
    expect(requests).toEqual([`/${manifestKey}`, `/${scriptKey}`, reportPath]);
  } finally {
    await server.stop(true);
  }
});

test("checks the complete package before a report is published, while admission still requires it", async () => {
  const { input, server, requests, manifestKey, scriptKey, reportPath } =
    fixture({ reportMissing: true });
  try {
    await expect(verifyPublishedReplayPackage(input)).resolves.toMatchObject({
      manifestPath: `/${manifestKey}`,
    });
    const packagePaths = [`/${manifestKey}`, `/${scriptKey}`];
    expect(requests).toEqual(packagePaths);
    requests.length = 0;
    await expect(verifyReplayAdmissionInputs(input)).rejects.toThrow(
      "HTTP 404",
    );
    expect(requests).toEqual([...packagePaths, reportPath]);
  } finally {
    await server.stop(true);
  }
});

test("public summary validation rejects additional fields without removing reviewed detail support", async () => {
  const { input, server, summary, detailedReport } = fixture();
  try {
    const admission = ReplayRenderPackageAdmissionSchema.parse(input.admission);
    expect(() =>
      validateReplayComparisonReport(summary, admission, protocol, {
        publicSummaryOnly: true,
      }),
    ).not.toThrow();
    expect(() =>
      validateReplayComparisonReport(detailedReport, admission, protocol),
    ).not.toThrow();
    expect(() =>
      validateReplayComparisonReport(detailedReport, admission, protocol, {
        publicSummaryOnly: true,
      }),
    ).toThrow("measurements");
  } finally {
    await server.stop(true);
  }
});

test.each([
  [{ outcome: "verified" }, "published"],
  [{ stage: "prod" }, "requested target"],
  [{ bucket: "different" }, "requested target"],
  [{ origin: "https://unrelated.example" }, "requested target"],
  [
    { manifestUrl: "https://unrelated.example/manifest.json" },
    "requested target",
  ],
] as const)(
  "rejects unbound receipts before fetching (%j)",
  async (fields, message) => {
    const { input, server, requests } = fixture();
    try {
      const publication = { ...input.publication, ...fields };
      await expect(
        verifyReplayAdmissionInputs({ ...input, publication }),
      ).rejects.toThrow(message);
      expect(requests).toEqual([]);
    } finally {
      await server.stop(true);
    }
  },
);

test.each([
  ["duplicate", { duplicate: true }],
  ["wrong bytes", { bytes: script.length + 1 }],
  ["wrong media type", { contentType: "text/html" }],
] as const)("rejects %s in the publication inventory", async (_, change) => {
  const { input, server, requests, manifestKey } = fixture();
  try {
    const [engine, manifest] = input.publication.objects;
    if (engine === undefined || manifest === undefined)
      throw new Error("Missing synthetic publication records");
    const objects =
      "duplicate" in change
        ? [engine, engine, manifest]
        : [{ ...engine, ...change }, manifest];
    await expect(
      verifyReplayAdmissionInputs({
        ...input,
        publication: { ...input.publication, objects },
      }),
    ).rejects.toThrow("manifest inventory");
    expect(requests).toEqual([`/${manifestKey}`]);
  } finally {
    await server.stop(true);
  }
});

test.each([
  [{ servedManifest: "{}" }, "JSON length or SHA-256"],
  [
    { servedScript: script.replace("Synthetic", "Incorrect") },
    "Public replay object length or SHA-256",
  ],
  [{ scriptMime: "text/html" }, "invalid immutable cache or MIME"],
  [{ cacheControl: "private, no-cache" }, "invalid immutable cache or MIME"],
  [{ redirect: true }, "fetch"],
  [{ servedReport: "{}" }, "JSON length or SHA-256"],
  [
    { reportProtocol: "f".repeat(16) },
    "does not bind the supplied reviewed admission",
  ],
  [
    { reportResult: "synthetic mismatch" },
    "does not bind the supplied reviewed admission",
  ],
  [
    { reportCoverage: "synthetic mismatch" },
    "does not bind the supplied reviewed admission",
  ],
] as const)(
  "rejects failed public readback or identity verification (%j)",
  async (options, message) => {
    const { input, server } = fixture(options);
    try {
      await expect(verifyReplayAdmissionInputs(input)).rejects.toThrow(message);
    } finally {
      await server.stop(true);
    }
  },
);
