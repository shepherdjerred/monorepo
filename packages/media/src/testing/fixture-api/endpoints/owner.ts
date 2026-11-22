import {
  ProfileDefaultsSchema,
  ProfileListSchema,
  UserListSchema,
} from "#shared/api.ts";
import { ProviderListSchema, SubtitleTargetListSchema } from "#shared/admin.ts";
import { CapacityViewSchema } from "#shared/capacity/view.ts";
import { BundleReviewListSchema } from "#shared/migration-handoff.ts";
import { MigrationProposalListSchema } from "#shared/migration.ts";
import {
  NumberingEpisodeListSchema,
  NumberingSeriesListSchema,
} from "#shared/numbering.ts";
import { PlexProfilesSchema } from "#shared/plex-admin.ts";
import { QualityGuideStatusSchema } from "#shared/quality-guide/view.ts";
import { RecoveryDetailSchema, RecoveryListSchema } from "#shared/recovery.ts";
import { LegacyRequesterListSchema } from "#shared/recovery-claims.ts";
import {
  endpoint,
  type FixtureEndpoint,
} from "#testing/fixture-api/endpoint.ts";
import {
  recoveryDetail,
  recoveryList,
  legacyRequesters,
} from "#testing/fixture-api/fixtures/recovery.ts";
import {
  capacityView,
  migrationBundles,
  migrationProposals,
  numberingEpisodes,
  numberingSeries,
  plexProfiles,
  providerList,
  subtitleTargets,
} from "#testing/fixture-api/fixtures/owner.ts";
import {
  profileDefaults,
  profileList,
  qualityGuideStatus,
} from "#testing/fixture-api/fixtures/profiles.ts";
import {
  FEATURED,
  resolveMedia,
} from "#testing/fixture-api/fixtures/titles.ts";
import { HOUSEHOLD } from "#testing/fixture-api/personas.ts";
import { fixtureId } from "#testing/fixture-api/support.ts";

/**
 * Quality profiles and recovery state. Profiles are owner data: a member's
 * list read succeeds, empty, and the defaults refuse a member.
 */
const shared: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/profiles",
    schema: ProfileListSchema,
    respond: (request) => (request.persona === "owner" ? profileList() : []),
    samples: ["/profiles"],
  }),
  endpoint({
    path: "/profile-defaults",
    access: "owner",
    schema: ProfileDefaultsSchema,
    respond: () => profileDefaults(),
    samples: ["/profile-defaults"],
  }),
  endpoint({
    path: "/recovery",
    schema: RecoveryListSchema,
    // A household that was never restored has no holds or reviews, and the
    // `recovery-*` scenarios are the other states the page shows.
    respond: (request) => recoveryList(request.persona, request.scenario),
    samples: ["/recovery"],
  }),
  endpoint({
    path: "/recovery/reviews/:id",
    schema: RecoveryDetailSchema,
    respond: (request) => recoveryDetail(request.persona, request.param("id")),
    belongsToRequest: (review, request) => review.id === request.param("id"),
    samples: [1, 2, 3, 4, 5, 6].map(
      (n) => `/recovery/reviews/${fixtureId(16, n)}`,
    ),
  }),
];

const administration: readonly FixtureEndpoint[] = [
  endpoint({
    path: "/admin/users",
    access: "owner",
    schema: UserListSchema,
    respond: () => [...HOUSEHOLD],
    samples: ["/admin/users"],
  }),
  endpoint({
    path: "/admin/providers",
    access: "owner",
    schema: ProviderListSchema,
    respond: () => providerList(),
    samples: ["/admin/providers"],
  }),
  endpoint({
    path: "/admin/capacity",
    access: "owner",
    schema: CapacityViewSchema,
    respond: () => capacityView(),
    samples: ["/admin/capacity"],
  }),
  endpoint({
    path: "/admin/plex/profiles",
    access: "owner",
    schema: PlexProfilesSchema,
    respond: () => plexProfiles(),
    samples: ["/admin/plex/profiles"],
  }),
  endpoint({
    path: "/admin/quality-guide",
    access: "owner",
    schema: QualityGuideStatusSchema,
    respond: () => qualityGuideStatus(),
    samples: ["/admin/quality-guide"],
  }),
  endpoint({
    path: "/admin/migration",
    access: "owner",
    schema: MigrationProposalListSchema,
    respond: () => migrationProposals(),
    samples: ["/admin/migration"],
  }),
  endpoint({
    path: "/admin/legacy-requester-bindings",
    access: "owner",
    schema: LegacyRequesterListSchema,
    respond: (request) => {
      const captureId = request.query.get("captureId");
      return captureId === null ? null : legacyRequesters(captureId);
    },
    belongsToRequest: (inventory, request) =>
      inventory.captureId === request.query.get("captureId"),
    samples: [
      `/admin/legacy-requester-bindings?captureId=${fixtureId(17, 102)}`,
    ],
  }),
  endpoint({
    path: "/admin/migration/bundles",
    access: "owner",
    schema: BundleReviewListSchema,
    respond: () => migrationBundles(),
    samples: ["/admin/migration/bundles"],
  }),
  endpoint({
    path: "/admin/subtitles/targets",
    access: "owner",
    schema: SubtitleTargetListSchema,
    respond: (request) => subtitleTargets(request.query.get("q") ?? ""),
    samples: ["/admin/subtitles/targets?q=", "/admin/subtitles/targets?q=dune"],
  }),
  endpoint({
    path: "/admin/numbering/series",
    access: "owner",
    schema: NumberingSeriesListSchema,
    respond: (request) => numberingSeries(request.query.get("q") ?? ""),
    samples: ["/admin/numbering/series?q=", "/admin/numbering/series?q=fri"],
  }),
  endpoint({
    path: "/admin/numbering/series/:id",
    access: "owner",
    schema: NumberingEpisodeListSchema,
    respond: (request) => {
      const resolved = resolveMedia(request.param("id"));
      return resolved?.item.kind === "series"
        ? numberingEpisodes(resolved.title)
        : null;
    },
    samples: [`/admin/numbering/series/${FEATURED.numbering.id}?offset=0`],
  }),
];

/** Library administration: the owner's pages and the data they share. */
export const OWNER_ENDPOINTS: readonly FixtureEndpoint[] = [
  ...shared,
  ...administration,
];
