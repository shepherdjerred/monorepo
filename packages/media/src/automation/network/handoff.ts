import type { MediaAutomationContext } from "#automation/context.ts";
import type { MediaHandoffNetworkActivities } from "#shared/automation.ts";
import { HandoffScopeProtocolSchema } from "#shared/handoff-v2.ts";
import { createHandoffNetworkProducer } from "#migration/handoff-network/producer.ts";
import type { HandoffNetworkContext } from "#migration/handoff-network/context.ts";
import { PlexPinAuthentication } from "#infrastructure/plex-auth.ts";

export function createHandoffNetworkActivities(
  context: MediaAutomationContext,
  input: {
    observer: HandoffNetworkContext["observer"];
    expectedServerMachineId: string;
    serverUrl: string;
    publicOrigin: string;
    canonicalRoots?: HandoffNetworkContext["canonicalRoots"];
  },
): MediaHandoffNetworkActivities {
  return {
    async observeMediaHandoff({ planId }) {
      const plan = await context.db.mediaHandoffPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      const scope = HandoffScopeProtocolSchema.parse(plan.scope);
      const sections = await context.permittedSections();
      if (!("schemaVersion" in scope)) await context.qbittorrent.login();
      await createHandoffNetworkProducer({
        ...context,
        observer: input.observer,
        expectedServerMachineId: input.expectedServerMachineId,
        ...(input.canonicalRoots === undefined
          ? {}
          : { canonicalRoots: input.canonicalRoots }),
        authentication: new PlexPinAuthentication({
          serverMachineId: input.expectedServerMachineId,
          serverUrl: input.serverUrl,
          permittedMovieSectionId: sections.movie,
          permittedTvSectionId: sections.series,
          applicationName: "Media",
          returnUrl: input.publicOrigin,
        }),
      })(planId);
    },
    async mediaHandoffState({ planId }) {
      const plan = await context.db.mediaHandoffPlan.findUniqueOrThrow({
        where: { id: planId },
        include: { receipt: true },
      });
      return { state: plan.state, applied: plan.receipt !== null };
    },
  };
}
