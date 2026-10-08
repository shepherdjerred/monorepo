import {
  StorableDarePileOnSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  defaultDareCalloutDependencies,
  ensureDareCallout,
  type DareCalloutDependencies,
} from "#src/betting/dares/presentation/dare-callout.ts";
import { dareIntentConfirmationComponents } from "#src/betting/dares/presentation/dare-components.ts";
import {
  parseDareCustomId,
  type DareCustomId,
} from "#src/betting/dares/lifecycle/dare-custom-id.ts";
import { deleteDareDraft } from "#src/betting/dares/lifecycle/dare-draft.ts";
import { consumeDareConfirmationIntent } from "#src/betting/dares/lifecycle/dare-intent-consume.ts";
import { createDareConfirmationIntent } from "#src/betting/dares/lifecycle/dare-intent.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { createLogger } from "#src/logger.ts";
import type { DareButtonInteractionBase } from "#src/betting/dares/presentation/dare-button-interaction.ts";

const logger = createLogger("betting-dare-discord-v2");

export type DareDiscordDependencies = DareCalloutDependencies & {
  createIntent: typeof createDareConfirmationIntent;
  consumeIntent: typeof consumeDareConfirmationIntent;
  deleteDraft: typeof deleteDareDraft;
  isPolicyEnabled: typeof isPolicyEnabled;
};

export const defaultDareDiscordDependencies: DareDiscordDependencies = {
  ...defaultDareCalloutDependencies,
  createIntent: createDareConfirmationIntent,
  consumeIntent: consumeDareConfirmationIntent,
  deleteDraft: deleteDareDraft,
  isPolicyEnabled,
};

function actionPayload(parsed: Extract<DareCustomId, { kind: "prepare" }>) {
  if (parsed.action === "contribute") {
    if (parsed.amount === null) {
      throw new Error("Dare contribution button has no amount.");
    }
    return {
      kind: "dare_contribute" as const,
      // The custom-id parser yields a plain integer; parse it into the
      // branded pile-on at this Discord boundary.
      amount: StorableDarePileOnSchema.parse(parsed.amount),
    };
  }
  if (parsed.action === "accept") return { kind: "dare_accept" as const };
  return parsed.action === "decline"
    ? { kind: "dare_decline" as const }
    : { kind: "dare_cancel" as const };
}

type DareDiscordContext = {
  interaction: DareButtonInteractionBase;
  serverId: ReturnType<typeof DiscordGuildIdSchema.parse>;
  actorDiscordId: ReturnType<typeof DiscordAccountIdSchema.parse>;
  dependencies: DareDiscordDependencies;
};

async function prepareAction(
  context: DareDiscordContext,
  parsed: Extract<DareCustomId, { kind: "prepare" }>,
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
    components: dareIntentConfirmationComponents(intent.intentId),
  });
}

async function consumeIntent(
  context: DareDiscordContext,
  intentId: string,
): Promise<void> {
  const intent =
    await context.dependencies.prismaClient.confirmationIntent.findUnique({
      where: { id: intentId },
      select: { dareId: true },
    });
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
  const dareId = intent?.dareId ?? null;
  if (dareId !== null) {
    try {
      await ensureDareCallout(dareId, context.dependencies);
    } catch (error) {
      deliveryFailed = true;
      logger.error(
        `Dare ${dareId.toString()} action committed but its callout failed:`,
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
  context: DareDiscordContext,
  parsed: Extract<DareCustomId, { kind: "delete" }>,
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

export async function handleDareButton(
  interaction: DareButtonInteractionBase,
  dependencies: DareDiscordDependencies = defaultDareDiscordDependencies,
): Promise<void> {
  const parsed = parseDareCustomId(interaction.customId);
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
