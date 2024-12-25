import {
  channelMention,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextBasedChannel,
  userMention,
  VoiceBasedChannel,
} from "npm:discord.js@14.14.1";
import { shoukaku } from "./index.ts";
import client from "../discord/client.ts";
import { LoadType, Player, Track } from "https://esm.sh/shoukaku@4.0.1";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";

let state: State = { name: "init" };

type State = InitState | IdleState | ActiveState;
type InitState = {
  name: "init";
};
type IdleState = {
  name: "idle";
  player: Player;
  musicChannel: VoiceBasedChannel;
  commandTextChannel: TextBasedChannel;
};
type ActiveState = {
  name: "active";
  player: Player;
  musicChannel: VoiceBasedChannel;
  commandTextChannel: TextBasedChannel;
  currentSong: Track;
  queue: Track[];
};

const musicCommand = new SlashCommandBuilder()
  .setName("music")
  .setDescription("Manage music playback")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("play")
      .setDescription("Play music")
      .addStringOption((option) =>
        option
          .setName("song")
          .setDescription("The song to play")
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("pause").setDescription("Pause music")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("resume").setDescription("Resume music")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("stop").setDescription("Stop music")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("skip").setDescription("Skip music")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("queue").setDescription("Show the music queue")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("clear").setDescription("Clear the music queue")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("shuffle").setDescription("Shuffle the music queue")
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("volume")
      .setDescription("Set the volume of the music")
      .addIntegerOption((option) =>
        option
          .setName("volume")
          .setDescription("The volume to set")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(10)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("seek")
      .setDescription("Seek to a position in the music")
      .addIntegerOption((option) =>
        option
          .setName("position")
          .setDescription("The position to seek to in seconds")
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("nowplaying")
      .setDescription("Show the currently playing song")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("reset").setDescription("Reset the music filters")
  );

async function handleMusic(interaction: ChatInputCommandInteraction) {
  switch (interaction.options.getSubcommand()) {
    case "play":
      await handlePlayMusic(interaction);
      break;
    case "pause":
      await handlePauseMusic(interaction);
      break;
    case "resume":
      await handleResumeMusic(interaction);
      break;
    case "stop":
      await handleStopMusic(interaction);
      break;
    case "skip":
      await handleSkipMusic(interaction);
      break;
    case "queue":
      await handleQueueMusic(interaction);
      break;
    case "clear":
      await handleClearMusic(interaction);
      break;
    case "shuffle":
      await handleShuffleMusic(interaction);
      break;
    case "volume":
      await handleVolumeMusic(interaction);
      break;
    case "seek":
      await handleSeekMusic(interaction);
      break;
    case "nowplaying":
      await handleNowPlayingMusic(interaction);
      break;
    case "reset":
      await handleResetMusic(interaction);
      break;
    default:
      throw new Error("unreachable");
  }
}

async function handleResetMusic(interaction: ChatInputCommandInteraction) {
  if ("player" in state) {
    await state.player.clearFilters();
    await interaction.reply(
      `${userMention(interaction.user.id)} reset filters.`,
    );
  } else {
    await interaction.reply({
      ephemeral: true,
      content: "The music bot isn't active.",
    });
  }
}

async function handlePauseMusic(interaction: ChatInputCommandInteraction) {
  if (state.name === "active") {
    if (state.player.paused) {
      await interaction.reply({
        ephemeral: true,
        content: "The music is already paused.",
      });
      return;
    } else {
      await state.player.setPaused(true);
      await interaction.reply(
        `${userMention(interaction.user.id)} paused the music.`,
      );
    }
  } else {
    await interaction.reply({
      ephemeral: true,
      content: "Nothing is playing.",
    });
  }
}

async function handleResumeMusic(interaction: ChatInputCommandInteraction) {
  if (state.name === "active") {
    if (state.player.paused) {
      await state.player.setPaused(false);
      await interaction.reply(
        `${userMention(interaction.user.id)} resumed the music.`,
      );
    } else {
      await interaction.reply({
        ephemeral: true,
        content: "The music is not paused.",
      });
    }
  } else {
    await interaction.reply({
      ephemeral: true,
      content: "Nothing is playing.",
    });
  }
}

async function handleStopMusic(interaction: ChatInputCommandInteraction) {
  if ("player" in state) {
    await state.player.stopTrack();
    if (state.musicChannel) {
      await shoukaku.leaveVoiceChannel(state.musicChannel.guild.id);
    }

    state = { name: "init" };

    await interaction.reply(
      `${userMention(interaction.user.id)} stopped the music.`,
    );
  } else {
    await interaction.reply({
      ephemeral: true,
      content: "The music bot isn't active.",
    });
  }
}

async function handleSkipMusic(interaction: ChatInputCommandInteraction) {
  if (state.name === "active") {
    const currentCopy = state.currentSong;
    await state.player.stopTrack();
    await interaction.reply(
      `${userMention(interaction.user.id)} skipped ${currentCopy.info.title}.`,
    );
  } else {
    await interaction.reply({
      ephemeral: true,
      content: "Nothing is playing.",
    });
  }
}

async function handleQueueMusic(interaction: ChatInputCommandInteraction) {
  if ("queue" in state) {
    const songs = state.queue.map(
      (track) =>
        `* ${track.info.title} by ${track.info.author} - ${track.info.uri}`,
    );
    await interaction.reply({
      content: `Queue:\n${songs.join("\n")}`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({ ephemeral: true, content: "Invalid state" });
    throw new Error("invalid state");
  }
}

async function handleClearMusic(interaction: ChatInputCommandInteraction) {
  if ("queue" in state) {
    state.queue = [];
    await interaction.reply(
      `${userMention(interaction.user.id)} cleared the queue.`,
    );
  } else {
    await interaction.reply({ ephemeral: true, content: "Invalid state" });
    throw new Error("invalid state");
  }
}

async function handleShuffleMusic(interaction: ChatInputCommandInteraction) {
  if ("queue" in state) {
    state.queue = _.shuffle(state.queue);
    await interaction.reply(
      `${userMention(interaction.user.id)} shuffled the queue.`,
    );
  } else {
    await interaction.reply({ ephemeral: true, content: "Invalid state" });
    throw new Error("invalid state");
  }
}

async function handleVolumeMusic(interaction: ChatInputCommandInteraction) {
  const volume = interaction.options.getInteger("volume", true);
  if ("player" in state) {
    await state.player.setFilterVolume(volume);
    await interaction.reply(
      `${userMention(interaction.user.id)} set volume to ${volume}%`,
    );
  } else {
    await interaction.reply({
      ephemeral: true,
      content: "The music bot isn't active.",
    });
  }
}

async function handleSeekMusic(interaction: ChatInputCommandInteraction) {
  const position = interaction.options.getInteger("position", true);
  if (state.name === "active") {
    await state.player.seekTo(position * 1000);
    await interaction.reply(
      `${userMention(interaction.user.id)} seeked to ${position} seconds.`,
    );
  } else {
    await interaction.reply({
      ephemeral: true,
      content: "Nothing is playing.",
    });
  }
}

async function handleNowPlayingMusic(interaction: ChatInputCommandInteraction) {
  if (state.name === "active") {
    await interaction.reply({
      content:
        `Now playing: ${state.currentSong.info.title} by ${state.currentSong.info.author} - ${state.currentSong.info.uri}`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      ephemeral: true,
      content: "Nothing is playing.",
    });
  }
}

async function getVoiceChannel(
  interaction: ChatInputCommandInteraction,
): Promise<VoiceBasedChannel | undefined> {
  const guildId = interaction.guildId;
  const memberId = interaction.user.id;
  if (!guildId) {
    return undefined;
  }
  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(memberId);

  // check if the member is in a voice channel
  if (!member.voice.channel) {
    console.log(member);
    return undefined;
  }

  return member.voice.channel;
}

async function findSong(song: string): Promise<Track | undefined> {
  const search = `ytsearch:${song}`;
  // TODO: don't prepend ytsearch: if the song is a url
  // TODO: add spotify credentials, hook up spotify

  const node = shoukaku.options.nodeResolver(shoukaku.nodes);
  if (!node) {
    console.error(`node is undefined`);
    return undefined;
  }
  const result = await node.rest.resolve(search);
  // TODO: add playlist support
  if (result?.loadType === LoadType.SEARCH) {
    const track = result.data.shift();
    return track;
  } else if (result?.loadType === LoadType.TRACK) {
    return result.data;
  } else if (result?.loadType === LoadType.PLAYLIST) {
    return result.data.tracks.shift();
  }
  return undefined;
}

async function handlePlayMusic(interaction: ChatInputCommandInteraction) {
  const song = interaction.options.getString("song", true);

  const metadata = await findSong(song);
  if (!metadata) {
    await interaction.reply({
      ephemeral: true,
      content: `No track matches \`${song}\``,
    });
    return;
  }

  const playerChannel = await getVoiceChannel(interaction);
  if (!playerChannel) {
    await interaction.reply({
      ephemeral: true,
      content: "You must be in a voice channel to play music.",
    });
    return;
  }

  if (
    "musicChannel" in state &&
    state.musicChannel?.id !== undefined &&
    state.musicChannel.id !== playerChannel.id
  ) {
    await interaction.reply({
      ephemeral: true,
      content: `Music is already playing in ${
        channelMention(
          state.musicChannel.id,
        )
      }`,
    });
    return;
  }

  if (interaction.channel === null) {
    await interaction.reply({
      ephemeral: true,
      content: "Text channel is null",
    });
    return;
  }

  if (state.name === "init") {
    const node = shoukaku.options.nodeResolver(shoukaku.nodes);
    if (!node) {
      return undefined;
    }

    state = {
      name: "idle",
      player: await shoukaku.joinVoiceChannel({
        guildId: playerChannel.guild.id,
        channelId: playerChannel.id,
        shardId: 0,
      }),
      musicChannel: playerChannel,
      commandTextChannel: interaction.channel,
    };

    state.player.on("end", handleSongEnd);
  }

  if (state.name === "idle") {
    state = {
      name: "active",
      player: state.player,
      musicChannel: state.musicChannel,
      commandTextChannel: state.commandTextChannel,
      currentSong: metadata,
      queue: [],
    };

    await state.player.playTrack({
      track: metadata.encoded,
    });

    await interaction.reply(
      `Now playing: ${metadata.info.title} by ${metadata.info.author} - ${metadata.info.uri}`,
    );
  } else {
    state.queue.push(metadata);
    await interaction.reply(
      `Added ${metadata.info.title} by ${metadata.info.author} - ${metadata.info.uri} to the queue.`,
    );
  }
}

function handleSongEnd() {
  void (async () => {
    if (state.name !== "active") {
      console.error(`state was not active at the end of a song`);
    } else {
      const next = state.queue.pop();
      if (next === undefined) {
        state = {
          name: "idle",
          player: state.player,
          musicChannel: state.musicChannel,
          commandTextChannel: state.commandTextChannel,
        };
        void state.commandTextChannel.send("The queue is empty.");
      } else {
        state.currentSong = next;
        await state.player.playTrack({
          track: next.encoded,
        });
        if (state.commandTextChannel === undefined) {
          console.error(`textChannel is undefined at the end of a song`);
        } else {
          void state.commandTextChannel.send(
            `Now playing: ${next.info.title} by ${next.info.author} - ${next.info.uri}`,
          );
        }
      }
    }
  })();
}

export { handleMusic, musicCommand };
