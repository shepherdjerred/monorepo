/**
 * A2UI to Discord Renderer
 * Converts A2UI components to Discord.js message payloads
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIEmbed,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
} from "discord.js";

import type {
  A2UIComponent,
  ComponentDefinition,
  TextComponent,
  ButtonComponent,
  CardComponent,
  RowComponent,
  ColumnComponent,
  ListComponent,
  ImageComponent,
  IconComponent,
  DividerComponent,
  TabsComponent,
  ProgressIndicatorComponent,
  Children,
  TextUsageHint,
} from "./types.js";
import { resolveString, resolveNumber, type DataModel } from "./data-binding.js";
import { iconToDiscordEmoji } from "./icon-map.js";

// ============= Types =============

export type DiscordMessagePayload = {
  content?: string;
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIComponentInMessageActionRow>[];
};

export type RenderContext = {
  components: Map<string, A2UIComponent>;
  dataModel: DataModel;
  surfaceId: string;
};

type RenderedContent = {
  text: string;
  embeds: EmbedBuilder[];
  buttons: ButtonBuilder[];
  images: string[];
};

// ============= Text Formatting =============

function formatTextWithHint(text: string, usageHint?: TextUsageHint): string {
  switch (usageHint) {
    case "h1":
      return `# ${text}`;
    case "h2":
      return `## ${text}`;
    case "h3":
      return `### ${text}`;
    case "h4":
    case "h5":
      return `**${text}**`;
    case "caption":
      return `-# ${text}`;
    case "body":
    default:
      return text;
  }
}

// ============= Progress Bar =============

function renderProgressBar(progress: number, width = 10): string {
  const filled = Math.round(progress * width);
  const empty = width - filled;
  const filledChars = "▓".repeat(Math.max(0, filled));
  const emptyChars = "░".repeat(Math.max(0, empty));
  const percentage = Math.round(progress * 100);
  return `${filledChars}${emptyChars} ${String(percentage)}%`;
}

// ============= Children Resolution =============

function resolveChildren(
  children: Children,
  ctx: RenderContext
): A2UIComponent[] {
  if ("explicitList" in children) {
    return children.explicitList
      .map((id) => ctx.components.get(id))
      .filter((c): c is A2UIComponent => c !== undefined);
  }

  // Template children - resolve from data model
  const { template } = children;
  const arrayData = ctx.dataModel[template.dataBinding.replace(/^\//, "")];
  if (!Array.isArray(arrayData)) {
    return [];
  }

  // For template children, we'd need to instantiate the template component
  // for each item in the array. For now, return empty as this requires
  // more complex template instantiation logic.
  return [];
}

// ============= Component Renderers =============

function renderText(
  component: TextComponent["Text"],
  ctx: RenderContext
): RenderedContent {
  const text = resolveString(component.text, ctx.dataModel);
  const formatted = formatTextWithHint(text, component.usageHint);
  return { text: formatted, embeds: [], buttons: [], images: [] };
}

function renderButton(
  component: ButtonComponent["Button"],
  componentId: string,
  ctx: RenderContext
): RenderedContent {
  // Resolve button label from child component
  const childComponent = ctx.components.get(component.child);
  let label = "Button";

  if (childComponent) {
    const childContent = renderComponent(childComponent, ctx);
    label = childContent.text || "Button";
  }

  // Truncate label to Discord's limit (80 chars)
  if (label.length > 80) {
    label = label.slice(0, 77) + "...";
  }

  // Create custom_id that encodes action info
  const customId = JSON.stringify({
    surfaceId: ctx.surfaceId,
    componentId,
    action: component.action.name,
    context: component.action.context,
  });

  // Truncate custom_id if needed (100 char limit)
  const truncatedCustomId = customId.length > 100
    ? customId.slice(0, 100)
    : customId;

  const button = new ButtonBuilder()
    .setCustomId(truncatedCustomId)
    .setLabel(label)
    .setStyle(component.primary ? ButtonStyle.Primary : ButtonStyle.Secondary);

  return { text: "", embeds: [], buttons: [button], images: [] };
}

function renderCard(
  component: CardComponent["Card"],
  ctx: RenderContext
): RenderedContent {
  const childComponent = ctx.components.get(component.child);
  if (!childComponent) {
    return { text: "", embeds: [], buttons: [], images: [] };
  }

  const childContent = renderComponent(childComponent, ctx);

  // Create an embed for the card
  const embed = new EmbedBuilder()
    .setColor(0x5865f2) // Discord blurple
    .setDescription(childContent.text || null);

  // Add any images from child content
  if (childContent.images.length > 0 && childContent.images[0] !== undefined) {
    embed.setImage(childContent.images[0]);
  }

  return {
    text: "",
    embeds: [embed, ...childContent.embeds],
    buttons: childContent.buttons,
    images: childContent.images.slice(1),
  };
}

function renderRow(
  component: RowComponent["Row"],
  ctx: RenderContext
): RenderedContent {
  const children = resolveChildren(component.children, ctx);
  const result: RenderedContent = { text: "", embeds: [], buttons: [], images: [] };

  for (const child of children) {
    const childContent = renderComponent(child, ctx);
    if (childContent.text) {
      result.text += (result.text ? " " : "") + childContent.text;
    }
    result.embeds.push(...childContent.embeds);
    result.buttons.push(...childContent.buttons);
    result.images.push(...childContent.images);
  }

  return result;
}

function renderColumn(
  component: ColumnComponent["Column"],
  ctx: RenderContext
): RenderedContent {
  const children = resolveChildren(component.children, ctx);
  const result: RenderedContent = { text: "", embeds: [], buttons: [], images: [] };

  for (const child of children) {
    const childContent = renderComponent(child, ctx);
    if (childContent.text) {
      result.text += (result.text ? "\n" : "") + childContent.text;
    }
    result.embeds.push(...childContent.embeds);
    result.buttons.push(...childContent.buttons);
    result.images.push(...childContent.images);
  }

  return result;
}

function renderList(
  component: ListComponent["List"],
  ctx: RenderContext
): RenderedContent {
  const children = resolveChildren(component.children, ctx);
  const isHorizontal = component.direction === "horizontal";
  const separator = isHorizontal ? " • " : "\n";

  const result: RenderedContent = { text: "", embeds: [], buttons: [], images: [] };

  for (const child of children) {
    const childContent = renderComponent(child, ctx);
    if (childContent.text) {
      const prefix = isHorizontal ? "" : "• ";
      result.text += (result.text ? separator : "") + prefix + childContent.text;
    }
    result.embeds.push(...childContent.embeds);
    result.buttons.push(...childContent.buttons);
    result.images.push(...childContent.images);
  }

  return result;
}

function renderImage(
  component: ImageComponent["Image"],
  ctx: RenderContext
): RenderedContent {
  const url = resolveString(component.url, ctx.dataModel);

  // For thumbnail/avatar, we'll add to embed later
  // For larger images, include as main image
  return { text: "", embeds: [], buttons: [], images: [url] };
}

function renderIcon(
  component: IconComponent["Icon"],
  ctx: RenderContext
): RenderedContent {
  const iconName = resolveString(component.name, ctx.dataModel);
  const emoji = iconToDiscordEmoji(iconName);
  return { text: emoji, embeds: [], buttons: [], images: [] };
}

function renderDivider(_component: DividerComponent["Divider"]): RenderedContent {
  return { text: "\n───────────────────\n", embeds: [], buttons: [], images: [] };
}

function renderTabs(
  component: TabsComponent["Tabs"],
  ctx: RenderContext
): RenderedContent {
  // Render tabs as buttons (first tab selected by default)
  const buttons: ButtonBuilder[] = [];

  for (let i = 0; i < component.tabItems.length; i++) {
    const tab = component.tabItems[i];
    if (!tab) continue;

    const title = resolveString(tab.title, ctx.dataModel);
    const customId = JSON.stringify({
      surfaceId: ctx.surfaceId,
      action: "selectTab",
      tabIndex: i,
    });

    const button = new ButtonBuilder()
      .setCustomId(customId.slice(0, 100))
      .setLabel(title)
      .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary);

    buttons.push(button);
  }

  // Render first tab's content
  const firstTab = component.tabItems[0];
  let content: RenderedContent = { text: "", embeds: [], buttons, images: [] };

  if (firstTab) {
    const childComponent = ctx.components.get(firstTab.child);
    if (childComponent) {
      const childContent = renderComponent(childComponent, ctx);
      content = {
        ...childContent,
        buttons: [...buttons, ...childContent.buttons],
      };
    }
  }

  return content;
}

function renderProgressIndicator(
  component: ProgressIndicatorComponent["ProgressIndicator"],
  ctx: RenderContext
): RenderedContent {
  const progress = resolveNumber(component.progress, ctx.dataModel);
  const progressBar = renderProgressBar(progress);

  let text = progressBar;
  if (component.label) {
    const label = resolveString(component.label, ctx.dataModel);
    text = `${label}\n${progressBar}`;
  }

  return { text, embeds: [], buttons: [], images: [] };
}

// ============= Main Component Renderer =============

function renderComponentDefinition(
  def: ComponentDefinition,
  componentId: string,
  ctx: RenderContext
): RenderedContent {
  if ("Text" in def) {
    return renderText(def.Text, ctx);
  }
  if ("Button" in def) {
    return renderButton(def.Button, componentId, ctx);
  }
  if ("Card" in def) {
    return renderCard(def.Card, ctx);
  }
  if ("Row" in def) {
    return renderRow(def.Row, ctx);
  }
  if ("Column" in def) {
    return renderColumn(def.Column, ctx);
  }
  if ("List" in def) {
    return renderList(def.List, ctx);
  }
  if ("Image" in def) {
    return renderImage(def.Image, ctx);
  }
  if ("Icon" in def) {
    return renderIcon(def.Icon, ctx);
  }
  if ("Divider" in def) {
    return renderDivider(def.Divider);
  }
  if ("Tabs" in def) {
    return renderTabs(def.Tabs, ctx);
  }
  if ("ProgressIndicator" in def) {
    return renderProgressIndicator(def.ProgressIndicator, ctx);
  }

  return { text: "", embeds: [], buttons: [], images: [] };
}

function renderComponent(
  component: A2UIComponent,
  ctx: RenderContext
): RenderedContent {
  return renderComponentDefinition(component.component, component.id, ctx);
}

// ============= Public API =============

/**
 * Render an A2UI surface to a Discord message payload
 */
export function renderToDiscord(
  rootId: string,
  components: A2UIComponent[],
  dataModel: DataModel,
  surfaceId: string
): DiscordMessagePayload {
  const componentMap = new Map<string, A2UIComponent>();
  for (const component of components) {
    componentMap.set(component.id, component);
  }

  const ctx: RenderContext = {
    components: componentMap,
    dataModel,
    surfaceId,
  };

  const rootComponent = componentMap.get(rootId);
  if (!rootComponent) {
    return { embeds: [], components: [] };
  }

  const rendered = renderComponent(rootComponent, ctx);

  // Build the final message payload
  const embeds: APIEmbed[] = [];
  const actionRows: APIActionRowComponent<APIComponentInMessageActionRow>[] = [];

  // If we have text content and no embeds, create a main embed
  if (rendered.text && rendered.embeds.length === 0) {
    const mainEmbed = new EmbedBuilder()
      .setDescription(rendered.text)
      .setColor(0x5865f2);

    if (rendered.images.length > 0 && rendered.images[0] !== undefined) {
      mainEmbed.setImage(rendered.images[0]);
    }

    embeds.push(mainEmbed.toJSON());
  } else {
    // Add any text as content to first embed or create new embed
    if (rendered.text && rendered.embeds.length > 0 && rendered.embeds[0] !== undefined) {
      const firstEmbed = rendered.embeds[0];
      const existingDesc = firstEmbed.data.description ?? "";
      firstEmbed.setDescription(
        existingDesc ? `${rendered.text}\n\n${existingDesc}` : rendered.text
      );
    }

    for (const embed of rendered.embeds) {
      embeds.push(embed.toJSON());
    }
  }

  // Group buttons into action rows (max 5 per row)
  if (rendered.buttons.length > 0) {
    const buttonChunks: ButtonBuilder[][] = [];
    for (let i = 0; i < rendered.buttons.length; i += 5) {
      buttonChunks.push(rendered.buttons.slice(i, i + 5));
    }

    for (const chunk of buttonChunks) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(chunk);
      actionRows.push(row.toJSON());
    }
  }

  // Limit to Discord maximums
  const limitedEmbeds = embeds.slice(0, 10);
  const limitedRows = actionRows.slice(0, 5);

  return {
    embeds: limitedEmbeds,
    components: limitedRows,
  };
}

/**
 * Parse a button interaction custom_id to extract action info
 */
export function parseButtonInteraction(customId: string): {
  surfaceId: string;
  componentId?: string;
  action: string;
  context?: unknown;
} | null {
  try {
    const parsed = JSON.parse(customId) as {
      surfaceId?: string;
      componentId?: string;
      action?: string;
      context?: unknown;
    };
    if (typeof parsed.surfaceId !== "string" || typeof parsed.action !== "string") {
      return null;
    }
    const result: {
      surfaceId: string;
      componentId?: string;
      action: string;
      context?: unknown;
    } = {
      surfaceId: parsed.surfaceId,
      action: parsed.action,
    };
    if (parsed.componentId !== undefined) {
      result.componentId = parsed.componentId;
    }
    if (parsed.context !== undefined) {
      result.context = parsed.context;
    }
    return result;
  } catch {
    return null;
  }
}
