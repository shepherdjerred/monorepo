import type { MediaAutomationContext } from "#automation/context.ts";
import { ProviderIdSchema } from "#automation/providers.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type {
  ProviderCandidate,
  ProviderSearch,
} from "#integrations/providers.ts";
import {
  EpisodeProviderSearchProgressSchema,
  type EpisodeProviderSearchProgress,
} from "#shared/acquisition/provider-search.ts";
import type { MediaReconcileOperation } from "#shared/automation.ts";
import {
  CandidateSearchProgress,
  collectProviderSearchRound,
  includeFeedObservation,
  providerSearchTransition,
} from "./progress.ts";

type Candidate = NonNullable<
  NonNullable<
    EpisodeProviderSearchProgress["paging"]
  >["listings"][number]["candidate"]
>;

export class EpisodeSearchDeferred extends Error {
  constructor(
    readonly retryAt: number,
    readonly progress: EpisodeProviderSearchProgress,
  ) {
    super("Acquisition provider search is waiting for pacing or availability");
  }
}

export async function searchEpisodeProviders(input: {
  context: MediaAutomationContext;
  operation: MediaReconcileOperation;
  feedSourceId?: string | undefined;
  providers: readonly {
    id: string;
    credentialId: string | null;
    configuration: unknown;
  }[];
  criteria: unknown;
  search: Omit<ProviderSearch, "page">;
  assertAuthority: () => Promise<void>;
  assess: (source: ProviderCandidate) => Promise<{
    candidate: Candidate;
    eligibleAt?: number | undefined;
  } | null>;
}) {
  const {
    context,
    operation,
    providers,
    criteria,
    search,
    assertAuthority,
    assess,
    feedSourceId,
  } = input;
  const digest = identityHash({
    operationId: operation.operationId,
    mediaId: operation.mediaId,
    generation: operation.generation,
    criteria,
    search,
    ...(feedSourceId === undefined ? {} : { feedSourceId }),
    providers: providers.map(({ id, configuration, credentialId }) => ({
      id,
      configuration,
      credentialId,
    })),
  });
  const now = () => context.now?.().getTime() ?? Date.now();
  const progress = new CandidateSearchProgress<Candidate>(
    digest,
    EpisodeProviderSearchProgressSchema.optional().parse(
      operation.providerSearchProgress,
    ),
    now(),
  );
  const ids = providers.map(({ id }) => ProviderIdSchema.parse(id));
  await includeFeedObservation(progress, {
    db: context.db,
    cipher: context.cipher,
    providers: ids,
    assess,
    now,
    feedSourceId,
  });
  const deferred = await collectProviderSearchRound({
    now,
    providers: ids,
    progress,
    cipher: context.cipher,
    assess,
    readPage: (id, page) =>
      context.providers.withProvider(
        id,
        async (client) => {
          await assertAuthority();
          if (client.searchPage !== undefined)
            return client.searchPage({ ...search, page });
          if (page !== 1)
            throw new Error(
              "Tracker changed its episode search paging capability",
            );
          const candidates = await client.search({ ...search, page });
          return {
            candidates,
            nextPage: null,
            listingIds: candidates.map(
              ({ providerReleaseId }) => providerReleaseId,
            ),
          };
        },
        { deferLocalPacing: true },
      ),
  });
  const transition = await providerSearchTransition(progress, {
    db: context.db,
    providers: ids,
    deferred,
    now: now(),
  });
  if (transition.state === "waiting-for-provider")
    throw new EpisodeSearchDeferred(transition.retryAt, progress.checkpoint());
  return transition.candidates.map(({ releaseId }) => releaseId);
}
