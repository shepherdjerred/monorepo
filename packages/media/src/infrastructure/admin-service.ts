import nodePath from "node:path";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { CredentialCipher } from "#application/security.ts";
import {
  AdminProviderIdSchema,
  ProviderListSchema,
  ProviderConfigurationSchema,
  defaultProviderConfiguration,
  ProviderSeedingPolicySchema,
  TrackerProviderIdSchema,
  MAX_MANUAL_SUBTITLE_BYTES,
  type AdminProviderId,
  type SaveProvider,
  type ManualSubtitle,
} from "#shared/admin.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { currentSubtitleWork } from "#automation/subtitles/authority.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { createHash } from "node:crypto";
import { PrismaMediaCommands } from "./commands.ts";
import type { Database } from "./database.ts";
import { parseManualSubtitle, lockSubtitleAsset } from "./manual-subtitle.ts";
import { createManualReplacementCandidate } from "./manual-subtitle-replacement.ts";
import { queueOperation } from "#automation/store.ts";

const privateTrackers = new Set<AdminProviderId>([
  "privatehd",
  "avistaz",
  "animez",
]);
const credentialProviders = new Set<AdminProviderId>([
  ...privateTrackers,
  "opensubtitles",
  "assrt",
  "subhd",
]);
const secret = z.string().min(1).max(16_384);
const credentials: Partial<
  Record<AdminProviderId, z.ZodType<Record<string, string>>>
> = {
  privatehd: z
    .object({ username: secret, password: secret, pid: secret })
    .strict(),
  avistaz: z
    .object({ username: secret, password: secret, pid: secret })
    .strict(),
  animez: z
    .object({ username: secret, password: secret, pid: secret })
    .strict(),
  opensubtitles: z
    .object({
      apiKey: secret,
      userAgent: secret,
      username: secret,
      password: secret,
    })
    .strict(),
  assrt: z.object({ token: secret }).strict(),
  subhd: z
    .object({
      baseUrl: z.url().refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          url.username === "" &&
          url.password === "" &&
          url.search === "" &&
          url.hash === ""
        );
      }),
      token: secret,
      instanceId: secret,
    })
    .strict(),
};

function validateProvider(
  id: AdminProviderId,
  input: SaveProvider,
): Record<string, string> | null | undefined {
  if (privateTrackers.has(id) && input.seedingPolicy.kind === "public")
    throw new MediaError(
      "private_policy_required",
      "Private trackers require a verified private policy or continued seeding",
      422,
    );
  if (id !== "privatehd" && input.seedingPolicy.kind === "privatehd")
    throw new MediaError(
      "private_policy_mismatch",
      "The PrivateHD formula only applies to PrivateHD",
      422,
    );
  if (
    !TrackerProviderIdSchema.safeParse(id).success &&
    input.seedingPolicy.kind !== "unknown"
  )
    throw new MediaError(
      "subtitle_seeding_policy",
      "Subtitle providers do not have a seeding policy",
      422,
    );
  if (input.credential == null) return input.credential;
  const result = credentials[id]?.safeParse(input.credential);
  if (result?.success !== true)
    throw new MediaError(
      "invalid_provider_credential",
      "Credential fields do not match this provider",
      422,
    );
  return result.data;
}

function credentialFingerprint(
  cipher: CredentialCipher,
  id: string,
  credential: Record<string, string> | null | undefined,
): string {
  if (credential === undefined) return "preserve";
  return credential === null
    ? "remove"
    : cipher.fingerprint(
        JSON.stringify(
          Object.entries(credential).sort(([a], [b]) => a.localeCompare(b)),
        ),
        `provider-command:${id}`,
      );
}

export class PrismaAdminApplication extends PrismaMediaCommands {
  constructor(
    private readonly db: Database,
    private readonly cipher: CredentialCipher,
  ) {
    super(db, { keepDays: 30 });
  }

  async providers(actor: MediaActor) {
    requireOwner(actor);
    const rows = await this.db.mediaProvider.findMany();
    const leases = await this.db.providerLease.findMany();
    return ProviderListSchema.parse(
      AdminProviderIdSchema.options.map((id) => {
        const row = rows.find((item) => item.id === id);
        return {
          id,
          kind: TrackerProviderIdSchema.safeParse(id).success
            ? "tracker"
            : "subtitle",
          enabled: row?.enabled ?? false,
          configured: row !== undefined,
          credentialConfigured: row?.credentialId != null,
          configuration: ProviderConfigurationSchema.parse({
            ...defaultProviderConfiguration,
            ...z
              .record(z.string(), z.unknown())
              .parse(row?.configuration ?? {}),
          }),
          seedingPolicy: ProviderSeedingPolicySchema.parse(
            row?.seedingPolicy ?? { kind: "unknown" },
          ),
          updatedAt: row?.updatedAt ?? null,
          lastError: row?.lastError ?? null,
          feedState: row?.feedState ?? "unconfigured",
          lastFeedAt: row?.lastFeedAt ?? null,
          nextAllowedAt:
            leases.find((lease) => lease.providerId === id)?.nextAllowedAt ??
            null,
        };
      }),
    );
  }

  saveProvider(
    actor: MediaActor,
    key: string,
    id: AdminProviderId,
    input: SaveProvider,
  ) {
    requireOwner(actor);
    const credential = validateProvider(id, input);
    return this.command(
      actor,
      key,
      {
        kind: "configure_provider",
        input: {
          id,
          expectedUpdatedAt: input.expectedUpdatedAt,
          enabled: input.enabled,
          configuration: input.configuration,
          seedingPolicy: input.seedingPolicy,
          credential: credentialFingerprint(this.cipher, id, credential),
        },
      },
      async (tx) => {
        const existing = await tx.mediaProvider.findUnique({ where: { id } });
        if (
          (existing?.updatedAt.toISOString() ?? null) !==
          input.expectedUpdatedAt
        )
          throw new MediaError(
            "version_conflict",
            "Provider settings changed; refresh before saving",
            409,
          );
        let credentialId = existing?.credentialId ?? null;
        if (credential !== undefined) {
          const previousId = credentialId;
          const replacement =
            credential === null
              ? null
              : await tx.credential.create({
                  data: {
                    kind: `provider:${id}`,
                    ciphertext: this.cipher.encrypt(
                      JSON.stringify(credential),
                      `provider:${id}`,
                    ),
                  },
                });
          credentialId = replacement?.id ?? null;
          if (previousId !== null)
            await tx.credential.delete({ where: { id: previousId } });
        }
        if (
          credentialId === null &&
          input.enabled &&
          credentialProviders.has(id)
        )
          throw new MediaError(
            "provider_credentials_required",
            "Configure credentials before enabling this provider",
            422,
          );
        const data = {
          enabled: input.enabled,
          configuration: input.configuration,
          seedingPolicy: input.seedingPolicy,
          credentialId,
        };
        await tx.mediaProvider.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        });
        await tx.applicationEvent.create({
          data: {
            actorId: actor.id,
            kind: "provider_configured",
            payload: {
              providerId: id,
              enabled: input.enabled,
              credentialChanged: credential !== undefined,
            },
          },
        });
        return { status: "completed" };
      },
    );
  }

  async subtitleTargets(actor: MediaActor, query = "") {
    requireOwner(actor);
    const assets = await this.db.libraryAsset.findMany({
      where: {
        owned: true,
        state: "published",
        checksum: { not: null },
        coverage: {
          some: {
            current: true,
            media: { title: { contains: query, mode: "insensitive" } },
          },
        },
      },
      take: 200,
      orderBy: { createdAt: "desc" },
      include: {
        coverage: { where: { current: true }, include: { media: true } },
        subtitles: {
          where: { state: { in: ["validated", "installed"] } },
          take: 201,
        },
      },
    });
    if (assets.some((asset) => asset.subtitles.length > 200))
      throw new MediaError(
        "subtitle_inventory_large",
        "This video needs a bounded subtitle inventory review",
        409,
      );
    return assets.map((asset) => ({
      assetId: asset.id,
      version: asset.version,
      checksum: z.string().parse(asset.checksum),
      filename: nodePath.basename(asset.sourcePath ?? asset.path),
      titles: asset.coverage.map((coverage) => coverage.media.title),
      subtitles: asset.subtitles.map((subtitle) => ({
        id: subtitle.id,
        version: subtitle.version,
        state: subtitle.state,
        qualityStatus: subtitle.qualityStatus,
        language: subtitle.language,
        forced: subtitle.forced,
        hearingImpaired: subtitle.hearingImpaired,
        providerId: subtitle.providerId,
        filename:
          subtitle.path === null ? null : nodePath.basename(subtitle.path),
        storageKind: subtitle.storageKind,
      })),
      installedLanguages: asset.subtitles
        .filter((subtitle) =>
          subtitleAccepted({
            subtitle,
            asset,
            epoch: asset.ownershipEpoch,
            allowStaged: true,
          }),
        )
        .map((subtitle) => subtitle.language),
    }));
  }

  uploadSubtitle(actor: MediaActor, key: string, input: ManualSubtitle) {
    requireOwner(actor);
    const bytes = Buffer.from(input.contentBase64, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MANUAL_SUBTITLE_BYTES)
      throw new MediaError(
        "subtitle_size",
        "Subtitle must be between one byte and 8 MiB",
        422,
      );
    const validated = parseManualSubtitle(input, bytes);
    if (input.replacementFor !== undefined)
      return this.command(
        actor,
        key,
        { kind: "upload_subtitle_replacement", input },
        (tx) =>
          createManualReplacementCandidate(tx, { actor, input, validated }),
      );
    return this.command(
      actor,
      key,
      { kind: "upload_subtitle", input },
      async (tx) => {
        const asset = await lockSubtitleAsset(tx, input);
        await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id='singleton' FOR SHARE`;
        await lockSubtitlePolicies(tx);
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const intents = await tx.mediaIntent.findMany({
          where: {
            mediaId: { in: asset.coverage.map((coverage) => coverage.mediaId) },
            edition: "default",
          },
        });
        if (
          intents.length !== asset.coverage.length ||
          intents.some((intent) => !intent.desiredPresence)
        )
          throw new MediaError(
            "subtitle_intent_changed",
            "The video is no longer requested for the library",
            409,
          );
        const work = await currentSubtitleWork(
          tx,
          asset.id,
          runtime.recoveryEpoch,
        );
        const existing = await tx.subtitleAsset.findFirst({
          where: {
            assetId: asset.id,
            language: input.language,
            state: { in: ["validated", "installed"] },
            forced: input.forced ?? false,
            hearingImpaired: input.hearingImpaired ?? null,
          },
        });
        if (existing !== null)
          throw new MediaError(
            "subtitle_exists",
            "This video already has that language and forced/HI variant; replacement requires review",
            409,
          );
        const subtitle = await tx.subtitleAsset.create({
          data: {
            assetId: asset.id,
            language: input.language,
            providerId: "manual",
            state: "validated",
            qualityStatus: "accepted",
            storageKind: "sidecar",
            ownershipEpoch: runtime.recoveryEpoch,
            checksum: createHash("sha256").update(validated.text).digest("hex"),
            videoChecksum: asset.checksum,
            videoVersion: asset.version,
            forced: input.forced ?? false,
            hearingImpaired: input.hearingImpaired ?? null,
            content: new TextEncoder().encode(validated.text),
            provenance: {
              filename: input.filename,
              description: input.description,
              format: validated.format,
              uploadedBy: actor.id,
              simplifiedEvidence: validated.simplifiedEvidence,
              traditionalEvidence: validated.traditionalEvidence,
            },
            matchingEvidence: {
              assetVersion: asset.version,
              assetChecksum: asset.checksum,
              exactMediaMatch: true,
              videoVersionMatch: true,
              ownerConfirmed: true,
              targetAuthority: work.authority,
              recoveryEpoch: runtime.recoveryEpoch,
              generations: Object.fromEntries(
                intents.map((intent) => [intent.mediaId, intent.generation]),
              ),
            },
          },
        });
        const operationId = await queueOperation(tx, {
          key: `manual-subtitle:${subtitle.id}`,
          kind: "install_subtitle",
          targetId: asset.id,
          userId: actor.id,
          payload: { subtitleId: subtitle.id },
        });
        await tx.applicationEvent.create({
          data: {
            actorId: actor.id,
            kind: "subtitle_uploaded",
            payload: {
              assetId: asset.id,
              subtitleId: subtitle.id,
              language: input.language,
            },
          },
        });
        return { operationId, status: "queued" };
      },
    );
  }
}
