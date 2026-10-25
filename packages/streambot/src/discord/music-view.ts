import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";

export type MusicBrowserPage = {
  title: string;
  description: string;
  items: readonly { title: string; subtitle: string; kind: string }[];
  previous: boolean;
  next: boolean;
  queueAll: boolean;
  url: string | undefined;
};
/** Rendering is separate from collectors so fixtures can exercise exact embeds/components. */
export function musicBrowserView(page: MusicBrowserPage) {
  const embed = new EmbedBuilder()
    .setTitle(page.title.slice(0, 256))
    .setDescription(page.description.slice(0, 512) || "Choose a result below.")
    .setColor(0x47_7e_3b);
  for (const item of page.items.slice(0, 10))
    embed.addFields({
      name: item.title.slice(0, 180),
      value: (item.subtitle || item.kind).slice(0, 280),
    });
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (page.items.length > 0)
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("music_choose")
          .setPlaceholder("Choose an artist, album, or song")
          .addOptions(
            page.items.slice(0, 10).map((item, index) => ({
              label: item.title.slice(0, 100),
              description: (item.subtitle || item.kind).slice(0, 100),
              value: String(index),
            })),
          ),
      ),
    );
  const buttons =
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("music_previous")
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!page.previous),
      new ButtonBuilder()
        .setCustomId("music_next")
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!page.next),
      new ButtonBuilder()
        .setCustomId("music_back")
        .setLabel("Back to search")
        .setStyle(ButtonStyle.Secondary),
    );
  if (page.queueAll)
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId("music_all")
        .setLabel("Queue album")
        .setStyle(ButtonStyle.Primary),
    );
  if (page.url !== undefined)
    buttons.addComponents(
      new ButtonBuilder()
        .setURL(page.url)
        .setLabel("Open in Streambot")
        .setStyle(ButtonStyle.Link),
    );
  rows.push(buttons);
  return { embeds: [embed], components: rows };
}
