import { z } from "zod";
import {
  ReplayRenderPackageAdmissionSchema,
  ReplayRenderPackageManifestSchema,
  type ReplayRenderPackageAdmission,
  type ReplayRenderPackageManifest,
} from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { normalizeGameBuild } from "@scout-for-lol/domain/artifacts/replay-transport.mjs";
import { openPublicReplayObject, verifyPublicReplayObject } from "./storage.ts";

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const Digest = z.string().regex(/^[0-9a-f]{64}$/);
const { gameBuild: GameBuild, protocol: ReplayProtocol } =
  ReplayRenderPackageManifestSchema.shape;
const PublicationObject = z.strictObject({
  key: z.string(),
  bytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024 * 1024),
  sha256: Digest,
  contentType: z.string().min(1),
});
const PublicationReceipt = z.strictObject({
  outcome: z.literal("published"),
  stage: z.enum(["beta", "prod"]),
  bucket: z.string().min(1),
  origin: z.url(),
  archiveDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  gameBuild: GameBuild,
  protocol: ReplayProtocol,
  manifestSha256: Digest,
  manifestUrl: z.url(),
  objects: z.array(PublicationObject).min(2).max(50_000),
});
const nativeComparison =
  ReplayRenderPackageAdmissionSchema.shape.nativeComparison.shape;
const ComparisonReport = z.object({
  schemaVersion: z.literal(1),
  gameBuild: GameBuild,
  protocol: ReplayProtocol,
  manifestSha256: Digest,
  rosterInventorySha256: Digest,
  referenceCaptureSha256: nativeComparison.referenceCaptureSha256,
  result: z.string(),
  coverage: z.string(),
});
const PublicComparisonSummary = ComparisonReport.strict();

type ReplayAdmissionInputs = {
  origin: URL;
  bucket: string;
  stage: "beta" | "prod";
  publication: unknown;
  admission: unknown;
};

export type VerifiedReplayAdmission = {
  gameBuild: string;
  protocol: string;
  manifestSha256: string;
  manifestPath: string;
  manifestJson: string;
  admissionJson: ReplayRenderPackageAdmission;
};

async function readPublicJson(
  origin: URL,
  key: string,
  sha256: string,
  expectedBytes?: number,
): Promise<string> {
  if (expectedBytes !== undefined && expectedBytes > MAX_JSON_BYTES)
    throw new Error(`Public replay JSON exceeds 16 MiB: ${key}`);
  const response = await openPublicReplayObject(
    origin,
    key,
    "application/json",
  );
  const hasher = new Bun.CryptoHasher("sha256");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response) {
    length += chunk.byteLength;
    if (length > (expectedBytes ?? MAX_JSON_BYTES))
      throw new Error(`Public replay JSON exceeds its expected length: ${key}`);
    hasher.update(chunk);
    chunks.push(chunk);
  }
  if (
    (expectedBytes !== undefined && length !== expectedBytes) ||
    hasher.digest("hex") !== sha256
  )
    throw new Error(
      `Public replay JSON length or SHA-256 does not match: ${key}`,
    );
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    Buffer.concat(chunks),
  );
}

function verifiedInventory(
  objects: z.infer<typeof PublicationObject>[],
  manifest: ReplayRenderPackageManifest,
  prefix: string,
) {
  const resources = objects.slice(0, -1);
  const byKey = new Map(resources.map((resource) => [resource.key, resource]));
  if (byKey.size !== resources.length || byKey.size !== manifest.files.length)
    throw new Error(
      "Publication receipt does not match the exact replay manifest inventory",
    );
  return manifest.files.map((member) => {
    const object = byKey.get(`${prefix}/${member.path}`);
    if (
      object?.bytes !== member.bytes ||
      object.sha256 !== member.sha256 ||
      object.contentType !== Bun.file(member.path).type
    )
      throw new Error(
        `Publication receipt differs from the replay manifest inventory: ${member.path}`,
      );
    return object;
  });
}

/** Check reviewed identity claims without creating or endorsing visual evidence. */
export function validateReplayComparisonReport(
  report: unknown,
  admission: ReplayRenderPackageAdmission,
  protocol: string,
  options?: { publicSummaryOnly?: boolean },
): void {
  const comparison = admission.nativeComparison;
  const schema =
    options?.publicSummaryOnly === true
      ? PublicComparisonSummary
      : ComparisonReport;
  const parsed = schema.parse(report);
  if (
    parsed.manifestSha256 !== admission.manifestSha256 ||
    parsed.gameBuild !== comparison.gameBuild ||
    parsed.protocol !== protocol ||
    parsed.rosterInventorySha256 !== admission.rosterInventorySha256 ||
    parsed.referenceCaptureSha256 !== comparison.referenceCaptureSha256 ||
    parsed.result !== comparison.result ||
    parsed.coverage !== comparison.coverage
  )
    throw new Error(
      "Public replay comparison report does not bind the supplied reviewed admission",
    );
}

/** Verify the published package before its comparison report is available. */
export async function verifyPublishedReplayPackage(
  input: ReplayAdmissionInputs,
): Promise<VerifiedReplayAdmission> {
  const receipt = PublicationReceipt.parse(input.publication);
  const admissionJson = ReplayRenderPackageAdmissionSchema.parse(
    input.admission,
  );
  const comparison = admissionJson.nativeComparison;
  if (
    comparison.reportPath !==
    `/replay-evidence/${comparison.reportSha256}/report.json`
  )
    throw new Error(
      "Replay comparison must name its canonical same-origin report path",
    );
  const { gameBuild, protocol, manifestSha256 } = receipt;
  const prefix = `replay-assets/${gameBuild}/${manifestSha256}`;
  const manifestKey = `${prefix}/manifest.json`;
  const manifestPath = `/${manifestKey}`;
  if (
    receipt.stage !== input.stage ||
    receipt.bucket !== input.bucket ||
    receipt.origin !== input.origin.origin ||
    receipt.manifestUrl !== new URL(manifestPath, input.origin).href ||
    normalizeGameBuild(gameBuild) !== gameBuild ||
    admissionJson.manifestSha256 !== manifestSha256 ||
    comparison.gameBuild !== gameBuild
  )
    throw new Error(
      "Replay publication receipt does not bind the requested target and reviewed admission",
    );

  const manifestRecord = receipt.objects.at(-1);
  if (
    manifestRecord?.key !== manifestKey ||
    manifestRecord.sha256 !== manifestSha256 ||
    manifestRecord.contentType !== "application/json"
  )
    throw new Error(
      "Replay publication receipt must end with the exact manifest record",
    );
  const manifestJson = await readPublicJson(
    input.origin,
    manifestKey,
    manifestSha256,
    manifestRecord.bytes,
  );
  const manifest = ReplayRenderPackageManifestSchema.parse(
    JSON.parse(manifestJson),
  );
  if (
    manifest.gameBuild !== gameBuild ||
    manifest.protocol !== protocol ||
    manifest.capabilities.rosterInventorySha256 !==
      admissionJson.rosterInventorySha256
  )
    throw new Error(
      "Public replay manifest does not bind the supplied publication and admission",
    );
  if (!Bun.file(manifest.entrypoint).type.startsWith("text/javascript"))
    throw new Error(
      "Public replay engine entrypoint must be a JavaScript module",
    );

  for (const object of verifiedInventory(receipt.objects, manifest, prefix))
    await verifyPublicReplayObject(input.origin, object);
  return {
    gameBuild,
    protocol,
    manifestSha256,
    manifestPath,
    manifestJson,
    admissionJson,
  };
}

/** Admission still requires an exact readback of the published comparison report. */
export async function verifyReplayAdmissionInputs(
  input: ReplayAdmissionInputs,
): Promise<VerifiedReplayAdmission> {
  const verified = await verifyPublishedReplayPackage(input);
  const comparison = verified.admissionJson.nativeComparison;
  const text = await readPublicJson(
    input.origin,
    comparison.reportPath.slice(1),
    comparison.reportSha256,
  );
  validateReplayComparisonReport(
    JSON.parse(text),
    verified.admissionJson,
    verified.protocol,
  );
  return verified;
}
