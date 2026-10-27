import { z } from "zod";
import {
  ProviderReferenceSchema,
  ProviderEditionEvidenceSchema,
} from "#shared/acquisition/catalog.ts";
import type { CredentialCipher } from "#application/security.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  KnabenProvider,
  PirateBayProvider,
  AvistazFamilyProvider,
  type ProviderCandidate,
  type ProviderSearch,
  type ProviderRecentPage,
} from "#integrations/providers.ts";
import { MagnetDownloadProvider } from "#integrations/magnetdownload.ts";
import { IntegrationError, type FetchTransport } from "#integrations/http.ts";
import { setTimeout } from "node:timers/promises";

export const ProviderIdSchema = z.enum([
  "knaben",
  "thepiratebay",
  "magnetdownload",
  "privatehd",
  "avistaz",
  "animez",
]);
export const StoredCandidateSchema = z.object({
  references: z.array(ProviderReferenceSchema).max(20).optional(),
  editionEvidence: z.array(ProviderEditionEvidenceSchema).max(20).optional(),
  providerId: ProviderIdSchema,
  providerReleaseId: z.string(),
  title: z.string(),
  sizeBytes: z.number(),
  seeders: z.number().nullable(),
  infoHash: z.string(),
  detailsUrl: z.string(),
  download: z.object({
    kind: z.enum(["magnet", "torrent"]),
    value: z.string(),
  }),
});
export type TrackerClient = {
  search: (input: ProviderSearch) => Promise<ProviderCandidate[]>;
  recent?: (input: { page: number }) => Promise<ProviderRecentPage>;
  download?: (candidate: ProviderCandidate) => Promise<Uint8Array<ArrayBuffer>>;
};
export type ProviderRegistry = {
  withProvider: <T>(
    providerId: string,
    work: (client: TrackerClient) => Promise<T>,
  ) => Promise<T>;
};

export class DatabaseProviderRegistry implements ProviderRegistry {
  constructor(
    private readonly db: Database,
    private readonly cipher: CredentialCipher,
  ) {}

  private async client(
    providerId: string,
    transport: FetchTransport,
  ): Promise<TrackerClient> {
    const id = ProviderIdSchema.parse(providerId);
    if (id === "knaben") return new KnabenProvider(transport);
    if (id === "thepiratebay") return new PirateBayProvider(transport);
    if (id === "magnetdownload") {
      const client = new MagnetDownloadProvider(transport);
      return {
        search: async (input) => {
          if (input.page !== undefined && input.page !== 1) return [];
          const results = await client.search(input.query);
          const candidates: ProviderCandidate[] = [];
          for (const result of results.slice(0, 3))
            candidates.push(await client.resolve(result));
          return candidates;
        },
      };
    }
    const provider = await this.db.mediaProvider.findUniqueOrThrow({
      where: { id },
    });
    if (provider.credentialId === null)
      throw new IntegrationError(id, "authentication");
    const credential = await this.db.credential.findUniqueOrThrow({
      where: { id: provider.credentialId },
    });
    const authentication = z
      .object({ username: z.string(), password: z.string(), pid: z.string() })
      .parse(
        JSON.parse(
          this.cipher.decrypt(credential.ciphertext, `provider:${id}`),
        ),
      );
    const client = new AvistazFamilyProvider(
      { providerId: id, ...authentication },
      transport,
    );
    await client.login();
    return client;
  }

  async withProvider<T>(
    providerId: string,
    work: (client: TrackerClient) => Promise<T>,
  ): Promise<T> {
    const configuration = await this.db.mediaProvider.findUniqueOrThrow({
      where: { id: providerId },
    });
    if (!configuration.enabled)
      throw new IntegrationError(providerId, "interaction-required");
    const policy = z
      .object({
        minimumIntervalSeconds: z.number().int().min(1).max(3600).default(10),
      })
      .parse(configuration.configuration);
    const ownerId = crypto.randomUUID();
    const now = new Date();
    await this.db.providerLease.upsert({
      where: { providerId },
      create: { providerId, nextAllowedAt: now },
      update: {},
    });
    const leased = await this.db.providerLease.updateMany({
      where: {
        providerId,
        nextAllowedAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { ownerId, leaseUntil: new Date(now.getTime() + 300_000) },
    });
    if (leased.count !== 1)
      throw new IntegrationError(providerId, "rate-limited");
    let backoffSeconds = policy.minimumIntervalSeconds;
    try {
      const result = await work(
        await this.client(
          providerId,
          this.transport(providerId, ownerId, policy.minimumIntervalSeconds),
        ),
      );
      await this.db.mediaProvider.update({
        where: { id: providerId },
        data: { lastError: null },
      });
      return result;
    } catch (error) {
      if (error instanceof IntegrationError) {
        backoffSeconds = Math.max(
          backoffSeconds,
          error.retryAfterSeconds ?? 60,
        );
        await this.db.mediaProvider.update({
          where: { id: providerId },
          data: { lastError: error.kind },
        });
      }
      throw error;
    } finally {
      await this.db.providerLease.updateMany({
        where: { providerId, ownerId },
        data: {
          ownerId: null,
          leaseUntil: null,
          nextAllowedAt: new Date(Date.now() + backoffSeconds * 1000),
        },
      });
    }
  }

  private transport(
    providerId: string,
    ownerId: string,
    intervalSeconds: number,
  ): FetchTransport {
    return async (url, init) => {
      const lease = await this.db.providerLease.findUniqueOrThrow({
        where: { providerId },
      });
      if (
        lease.ownerId !== ownerId ||
        lease.leaseUntil === null ||
        lease.leaseUntil.getTime() <= Date.now()
      )
        throw new IntegrationError(providerId, "conflict");
      const wait = Math.max(0, lease.nextAllowedAt.getTime() - Date.now());
      if (wait > 15_000)
        throw new IntegrationError(
          providerId,
          "rate-limited",
          429,
          Math.ceil(wait / 1000),
        );
      if (wait > 0)
        await setTimeout(
          wait,
          undefined,
          init.signal === undefined || init.signal === null
            ? {}
            : { signal: init.signal },
        );
      const changed = await this.db.providerLease.updateMany({
        where: { providerId, ownerId, leaseUntil: { gt: new Date() } },
        data: { nextAllowedAt: new Date(Date.now() + intervalSeconds * 1000) },
      });
      if (changed.count !== 1)
        throw new IntegrationError(providerId, "conflict");
      return fetch(url, init);
    };
  }
}
