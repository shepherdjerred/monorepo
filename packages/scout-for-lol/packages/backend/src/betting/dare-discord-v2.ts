import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  defaultDareV2CalloutDependencies,
  ensureDareV2Callout,
  type DareV2CalloutDependencies,
} from "#src/betting/dare-callout-v2.ts";
import { dareV2IntentConfirmationComponents } from "#src/betting/dare-components-v2.ts";
import {
  parseDareV2CustomId,
  type DareV2CustomId,
} from "#src/betting/dare-custom-id-v2.ts";
import { deleteDareDraftV2 } from "#src/betting/dare-draft-v2.ts";
import { consumeDareV2ConfirmationIntent } from "#src/betting/dare-intent-consume-v2.ts";
import { createDareV2ConfirmationIntent } from "#src/betting/dare-intent-v2.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { createLogger } from "#src/logger.ts";
import type { DareButtonInteractionBase } from "#src/betting/dare-button-interaction.ts";

const logger = createLogger("betting-dare-discord-v2");

export type DareV2DiscordDependencies = DareV2CalloutDependencies & {
  createIntent: typeof createDareV2ConfirmationIntent;
  consumeIntent: typeof consumeDareV2ConfirmationIntent;
  deleteDraft: typeof deleteDareDraftV2;
  isPolicyEnabled: typeof isPolicyEnabled;
};

export const defaultDareV2DiscordDependencies: DareV2DiscordDependencies = {
  ...defaultDareV2CalloutDependencies,
  createIntent: createDareV2ConfirmationIntent,
  consumeIntent: consumeDareV2ConfirmationIntent,
  deleteDraft: deleteDareDraftV2,
  isPolicyEnabled,
};

function actionPayload(parsed: Extract<DareV2CustomId, { kind: "prepare" }>) {
  if (parsed.action === "contribute") {
    if (parsed.amount === null) {
      throw new Error("Dare v2 contribution button has no amount.");
    }
    return { action: "contribute" as const, amount: parsed.amount };
  }
  if (parsed.action === "accept") return { action: "accept" as const };
  if (parsed.action === "decline") return { action: "decline" as const };
  return { action: "cancel" as const };
}

type DareV2DiscordContext = {
  interaction: DareButtonInteractionBase;
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>;
  actorDiscordId: ReturnType<typeof DiscordAccountIdSchema.parse>;
  dependencies: DareV2DiscordDependencies;
};

async function prepareAction(
  context: DareV2DiscordContext,
  parsed: Extract<DareV2CustomId, { kind: "prepare" }>,
): Promise<void> {
  await context.interaction.deferReply({ ephemeral: true });
  const intent = await context.dependencies.createIntent(
    {
      dareId: parsed.dareId,
      serverId: context.serverId,
      actorDiscordId: context.actorDiscordId,
      expectedRevision: parsed.revision,
      payload: actionPayload(parsed),
      idempotencyKey: globalThis.crypto.randomUUID(),
    },
    {
      prismaClient: context.dependencies.prismaClient,
      isPolicyEnabled: context.dependencies.isPolicyEnabled,
    },
  );
  if (intent.kind !== "intent_created") {
    await context.interaction.editReply({
      content: `That action is not available (${intent.kind.replaceAll("_", " ")}).`,
      components: [],
    });
    return;
  }
  await context.interaction.editReply({
    content: `Confirm **${intent.action}** for Dare #${parsed.dareId.toString()}. This confirmation expires <t:${Math.floor(intent.expiresAt.getTime() / 1000).toString()}:R>.`,
    components: dareV2IntentConfirmationComponents(intent.intentId),
  });
}

async function consumeIntent(
  context: DareV2DiscordContext,
  intentId: string,
): Promise<void> {
  const intent =
    await context.dependencies.prismaClient.bucksDareV2ConfirmationIntent.findUnique(
      {
        where: { id: intentId },
        select: { dareId: true },
      },
    );
  await context.interaction.deferUpdate();
  const outcome = await context.dependencies.consumeIntent(
    {
      intentId,
      serverId: context.serverId,
      actorDiscordId: context.actorDiscordId,
    },
    {
      prismaClient: context.dependencies.prismaClient,
      isPolicyEnabled: context.dependencies.isPolicyEnabled,
    },
  );
  let deliveryFailed = false;
  if (intent !== null) {
    try {
      await ensureDareV2Callout(intent.dareId, context.dependencies);
    } catch (error) {
      deliveryFailed = true;
      logger.error(
        `Dare v2 ${intent.dareId.toString()} action committed but its callout failed:`,
        error,
      );
    }
  }
  if (outcome.kind === "funded") {
    if (deliveryFailed) {
      await context.interaction.editReply({
        content:
          "The dare was funded, but Scout could not post its public callout. Nothing was reversed.",
        components: [],
        embeds: [],
      });
    } else {
      await context.interaction.editReply({
        content: `✅ Dare funded with ${outcome.potTotal.toString()} BB. The targets have until <t:${Math.floor(outcome.acceptDeadline.getTime() / 1000).toString()}:R> to accept.`,
        components: [],
        embeds: [],
      });
    }
    return;
  }
  await context.interaction.editReply({
    content: deliveryFailed
      ? `Dare action: **${outcome.kind.replaceAll("_", " ")}**. The public callout could not be refreshed.`
      : `Dare action: **${outcome.kind.replaceAll("_", " ")}**.`,
    components: [],
    embeds: [],
  });
}

async function deleteDraft(
  context: DareV2DiscordContext,
  parsed: Extract<DareV2CustomId, { kind: "delete" }>,
): Promise<void> {
  await context.interaction.deferUpdate();
  const outcome = await context.dependencies.deleteDraft(
    {
      dareId: parsed.dareId,
      serverId: context.serverId,
      challengerDiscordId: context.actorDiscordId,
      expectedRevision: parsed.revision,
    },
    {
      prismaClient: context.dependencies.prismaClient,
      isPolicyEnabled: context.dependencies.isPolicyEnabled,
    },
  );
  await context.interaction.editReply({
    content:
      outcome.kind === "deleted"
        ? "Draft cancelled. No BB moved."
        : "That draft is no longer editable.",
    components: [],
    embeds: [],
  });
}

export async function handleDareV2Button(
  interaction: DareButtonInteractionBase,
  dependencies: DareV2DiscordDependencies = defaultDareV2DiscordDependencies,
): Promise<void> {
  const parsed = parseDareV2CustomId(interaction.customId);
  if (parsed === undefined) return;
  if (interaction.guildId === null) {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: "Bryan Bucks dares only work inside a server.",
    });
    return;
  }
  const serverId = DiscordGuildIdSchema.parse(interaction.guildId);
  const actorDiscordId = DiscordAccountIdSchema.parse(interaction.user.id);
  const context = { interaction, serverId, actorDiscordId, dependencies };
  if (parsed.kind === "prepare") {
    await prepareAction(context, parsed);
    return;
  }
  if (parsed.kind === "delete") {
    await deleteDraft(context, parsed);
    return;
  }
  await consumeIntent(context, parsed.intentId);
}
