import {
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
} from "discord.js";

function query(
  sub: SlashCommandSubcommandBuilder,
  name: string,
  description: string,
) {
  return sub
    .setName(name)
    .setDescription(description)
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Artist, album, or song")
        .setRequired(true),
    );
}
function playlist(
  sub: SlashCommandSubcommandBuilder,
  name: string,
  description: string,
) {
  return sub
    .setName(name)
    .setDescription(description)
    .addStringOption((option) =>
      option
        .setName("playlist")
        .setDescription("Playlist name or ID")
        .setRequired(true),
    );
}
export const musicCommand = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Discover music and manage Streambot playlists")
  .addSubcommand((sub) =>
    query(sub, "search", "Search artists, albums, and songs").addStringOption(
      (option) =>
        option
          .setName("type")
          .setDescription("Result type")
          .addChoices(
            { name: "Everything", value: "all" },
            { name: "Artists", value: "artist" },
            { name: "Albums", value: "album" },
            { name: "Songs", value: "song" },
          ),
    ),
  )
  .addSubcommand((sub) =>
    query(sub, "artist", "Find an artist and browse releases"),
  )
  .addSubcommand((sub) =>
    query(sub, "album", "Find an album and browse tracks"),
  )
  .addSubcommand((sub) =>
    sub.setName("web").setDescription("Open the Streambot music browser"),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("playlist")
      .setDescription("Private and server-shared playlists")
      .addSubcommand((sub) =>
        sub
          .setName("list")
          .setDescription("Browse your or this server's playlists")
          .addStringOption((option) =>
            option
              .setName("scope")
              .setDescription("Which playlists")
              .addChoices(
                { name: "Mine", value: "mine" },
                { name: "This server", value: "server" },
              ),
          ),
      )
      .addSubcommand((sub) =>
        playlist(sub, "show", "Show a playlist and its tracks"),
      )
      .addSubcommand((sub) => playlist(sub, "play", "Queue a saved playlist"))
      .addSubcommand((sub) =>
        sub
          .setName("save")
          .setDescription(
            "Save current playback and queue as a private playlist",
          )
          .addStringOption((option) =>
            option
              .setName("name")
              .setDescription("New playlist name")
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        playlist(sub, "share", "Share your playlist with this server"),
      )
      .addSubcommand((sub) =>
        playlist(sub, "private", "Make your playlist private"),
      ),
  );
