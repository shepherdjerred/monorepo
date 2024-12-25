import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  userMention,
} from "npm:discord.js@14.14.1";

type State = InitState | PoolState | CaptainsState | DraftingState | ReadyState;
let state: State = { name: "init" };

type Members = [string, string, string, string];
type PartialMembers =
  | string[]
  | [string]
  | [string, string]
  | [string, string, string]
  | [string, string, string, string];
type Team = { captain: string; members: Members };
type PartialTeam = { captain: string; members: PartialMembers };
type PartialTeams = Record<TeamName, PartialTeam>;
type Teams = Record<TeamName, Team>;
type TeamName = "red" | "blue";

type InitState = {
  name: "init";
};

type PoolState = {
  name: "pool";
  host: string;
  players: string[];
};

type CaptainsState = {
  name: "captains";
  host: string;
  players: string[];
};

type DraftingState = {
  name: "drafting";
  host: string;
  players: string[];
  teams: PartialTeams;
};

type ReadyState = {
  name: "ready";
  host: string;
  teams: Record<TeamName, Team>;
};

function getCurrentPick(teams: PartialTeams): TeamName | undefined {
  const order: TeamName[] = [
    "red",
    "blue",
    "blue",
    "red",
    "red",
    "blue",
    "blue",
    "red",
  ];
  const turn = teams.red.members.length + teams.blue.members.length;
  if (turn === 8) {
    return undefined;
  }
  const team = order[turn];
  if (team === undefined) {
    throw new Error(`unreachable, ${JSON.stringify(state)}`);
  } else {
    return team;
  }
}

function printTeam(team: Team | PartialTeam) {
  return `${userMention(team.captain)}\n${
    team.members
      .map((member) => userMention(member))
      .join("\n")
  }`;
}

function printTeams(teams: Teams | PartialTeams) {
  return `Red Team:\n${printTeam(teams.red)}\n\nBlue Team:\n${
    printTeam(
      teams.blue,
    )
  }`;
}

function printPool(players: string[]) {
  return players.map((player) => userMention(player)).join("\n");
}

const customsCommand = new SlashCommandBuilder()
  .setName("customs")
  .setDescription("A tool for drafting League of Legends teams")
  .addSubcommand((subcommand) =>
    subcommand.setName("init").setDescription("initialize a new customs match")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("start").setDescription("start the match")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("debug").setDescription("print debug information")
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("reset").setDescription("reset the match")
  )
  .addSubcommandGroup((group) =>
    group
      .setName("captain")
      .setDescription("Manage team captains")
      .addSubcommand((subcommand) =>
        subcommand.setName("random").setDescription("Pick random team captains")
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("set")
          .setDescription("Set explicit team captains")
          .addUserOption((option) =>
            option
              .setName("red")
              .setDescription("red team captain")
              .setRequired(true)
          )
          .addUserOption((option) =>
            option
              .setName("blue")
              .setDescription("blue team captain")
              .setRequired(true)
          )
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("pool")
      .setDescription("Manage the player pool")
      .addSubcommand((subcommand) =>
        subcommand.setName("join").setDescription("Join the player pool")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("leave").setDescription("Leave the player pool")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("list").setDescription("List the player pool")
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("kick")
          .setDescription("Kick a player from the player pool")
          .addUserOption((option) =>
            option
              .setName("user")
              .setDescription("user to kick")
              .setRequired(true)
          )
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName("team")
      .setDescription("Manage teams")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("pick")
          .setDescription("Pick a player for your team")
          .addUserOption((option) =>
            option
              .setName("user")
              .setDescription("user to pick")
              .setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("list").setDescription("List the current teams")
      )
  );

async function handleCustoms(interaction: ChatInputCommandInteraction) {
  switch (interaction.options.getSubcommandGroup()) {
    case "captain":
      switch (interaction.options.getSubcommand()) {
        case "random":
          await handleCaptainRandom(interaction);
          break;
        case "set":
          await handleCaptainSet(interaction);
          break;
        default:
          throw new Error(`unreachable: ${JSON.stringify(interaction)}`);
      }
      break;
    case "pool":
      switch (interaction.options.getSubcommand()) {
        case "join":
          await handlePoolJoin(interaction);
          break;
        case "kick":
          await handlePoolKick(interaction);
          break;
        case "list":
          await handlePoolList(interaction);
          break;
        case "leave":
          await handlePoolLeave(interaction);
          break;
        default:
          throw new Error(`unreachable: ${JSON.stringify(interaction)}`);
      }
      break;
    case "team":
      switch (interaction.options.getSubcommand()) {
        case "pick":
          await handleTeamPick(interaction);
          break;
        case "list":
          await handleTeamList(interaction);
          break;
        default:
          throw new Error(`unreachable: ${JSON.stringify(interaction)}`);
      }
  }
  switch (interaction.options.getSubcommand()) {
    case "init":
      await handleInit(interaction);
      break;
    case "reset":
      await handleReset(interaction);
      break;
    case "start":
      await handleStart(interaction);
      break;
    case "debug":
      await handleDebug(interaction);
      break;
    default:
      throw new Error(`unreachable: ${JSON.stringify(interaction)}`);
  }
}

async function handleTeamList(interaction: ChatInputCommandInteraction) {
  if (!("teams" in state)) {
    await interaction.reply({
      content: "You can't list the teams right now.",
      ephemeral: true,
    });
    return;
  }

  return await interaction.reply({
    content: printTeams(state.teams),
    ephemeral: true,
  });
}

async function handlePoolList(interaction: ChatInputCommandInteraction) {
  if (!("players" in state)) {
    await interaction.reply({
      content: "You can't list the player pool right now.",
      ephemeral: true,
    });
    return;
  }

  return await interaction.reply({
    content: printPool(state.players),
    ephemeral: true,
  });
}

async function handlePoolLeave(interaction: ChatInputCommandInteraction) {
  if (!("players" in state)) {
    await interaction.reply({
      content: "You can't leave the player pool right now.",
      ephemeral: true,
    });
    return;
  }

  if (!state.players.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You are not in the player pool.",
      ephemeral: true,
    });
    return;
  }

  state.players = state.players.filter(
    (player) => player !== interaction.user.id,
  );
  state = { name: "pool", host: state.host, players: state.players };
  return await interaction.reply({
    content: `${userMention(interaction.user.id)} has left the player pool.`,
  });
}

async function handleDebug(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    content: `${JSON.stringify(state)}`,
    ephemeral: true,
  });
}

async function handleInit(interaction: ChatInputCommandInteraction) {
  if (state.name !== "init") {
    await interaction.reply({
      content: "A customs match has already been initialized.",
      ephemeral: true,
    });
    return;
  }

  state = {
    name: "pool",
    host: interaction.user.id,
    players: [interaction.user.id],
  };
  await interaction.reply({
    content: `${
      userMention(
        state.host,
      )
    } has initialized a new customs match. Use \`/customs pool join\` to join.`,
  });
}

async function handlePoolJoin(interaction: ChatInputCommandInteraction) {
  if (!("players" in state)) {
    await interaction.reply({
      content: "You can't join the player pool right now.",
      ephemeral: true,
    });
    return;
  }

  // don't allow a player to join twice
  if (state.players.includes(interaction.user.id)) {
    await interaction.reply({
      content: "You are already in the player pool.",
      ephemeral: true,
    });
    return;
  }

  state.players.push(interaction.user.id);
  if (state.players.length === 10) {
    state = {
      name: "captains",
      host: state.host,
      players: state.players,
    };
    await interaction.reply({
      content: `${
        userMention(
          interaction.user.id,
        )
      } joined the player pool. The player pool is now full. ${
        userMention(
          state.host,
        )
      } should now pick team captains with \`/customs captain random\` or \`/customs captain set\`.`,
    });
  } else {
    await interaction.reply({
      content: `${userMention(interaction.user.id)} joined the player pool. ${
        10 - state.players.length
      } more players needed. View the player pool with \`/customs pool list\`.`,
    });
  }
}

async function handlePoolKick(interaction: ChatInputCommandInteraction) {
  if (!("players" in state)) {
    await interaction.reply({
      content: "You can't kick players right now.",
      ephemeral: true,
    });
    return;
  }

  if (state.host !== interaction.user.id) {
    await interaction.reply({
      content: "You are not the host.",
      ephemeral: true,
    });
    return;
  }

  const user = interaction.options.getUser("user", true);
  if (state.players.includes(user.id)) {
    state.players = state.players.filter((player) => player !== user.id);
    if (state.players.length <= 9) {
      state = { name: "pool", host: state.host, players: state.players };
    }
    await interaction.reply({
      content: `${userMention(user.id)} has been kicked from the player pool.`,
    });
  } else {
    await interaction.reply({
      content: `${userMention(user.id)} is not in the player pool.`,
      ephemeral: true,
    });
  }
}

async function handleTeamPick(interaction: ChatInputCommandInteraction) {
  if (state.name !== "drafting") {
    await interaction.reply({
      content: "You can't pick players right now.",
      ephemeral: true,
    });
    return;
  }

  const user = interaction.options.getUser("user", true);
  const turn = getCurrentPick(state.teams);

  if (turn === undefined) {
    return await interaction.reply({
      content: `Unexpected state ${JSON.stringify(state)}`,
      ephemeral: true,
    });
  }

  const currentCaptainTurn = state.teams[turn].captain;

  if (currentCaptainTurn !== interaction.user.id) {
    return await interaction.reply({
      content: `You're not the captain for the ${turn} team.`,
      ephemeral: true,
    });
  }

  if (!state.players.includes(user.id)) {
    return await interaction.reply({
      content: "The user is not in the player pool or has already been picked.",
      ephemeral: true,
    });
  }

  // add the user to the team
  state.teams[turn].members.push(user.id);

  // remove the user from the player pool
  state.players = state.players.filter((player) => player !== user.id);
  const nextTurn = getCurrentPick(state.teams);
  if (nextTurn === undefined) {
    state = { name: "ready", host: state.host, teams: state.teams as Teams };
    return await interaction.reply({
      content: `${
        userMention(
          user.id,
        )
      } has been picked for the ${turn} team. Teams are now complete. Use \`/customs start\` to start the match.`,
    });
  } else {
    const pickingCaptain = state.teams[nextTurn].captain;
    return await interaction.reply({
      content: `${
        userMention(
          user.id,
        )
      } has been picked for the ${turn} team. It's now ${
        userMention(
          pickingCaptain,
        )
      }'s turn. Pick a member with \`/customs team pick\` The following players are up for draft: ${
        printPool(
          state.players,
        )
      }`,
    });
  }
}

async function handleReset(interaction: ChatInputCommandInteraction) {
  state = { name: "init" };
  await interaction.reply({ content: "Customs match state reset." });
}

async function handleStart(interaction: ChatInputCommandInteraction) {
  if (state.name !== "ready") {
    await interaction.reply({
      content: "You can't start the match right now.",
      ephemeral: true,
    });
    return;
  }

  if (state.host !== interaction.user.id) {
    await interaction.reply({
      content: "You are not the host.",
      ephemeral: true,
    });
    return;
  }

  // TODO: put teams in the correct channels
  state = { name: "init" };

  await interaction.reply({
    content: "Customs match started.",
    ephemeral: true,
  });
}

async function handleCaptainRandom(interaction: ChatInputCommandInteraction) {
  if (state.name !== "captains") {
    await interaction.reply({
      content: "You can't pick team captains right now.",
      ephemeral: true,
    });
    return;
  }

  if (state.host !== interaction.user.id) {
    await interaction.reply({
      content: "You are not the host.",
      ephemeral: true,
    });
    return;
  }

  const red = state.players[Math.floor(Math.random() * state.players.length)];
  state.players = state.players.filter((player) => player !== red);
  const blue = state.players[Math.floor(Math.random() * state.players.length)];
  state.players = state.players.filter((player) => player !== blue);

  if (red === undefined || blue === undefined) {
    await interaction.reply({
      content: `invalid state: ${JSON.stringify(state)}`,
    });
    throw new Error("unreachable");
  }

  state = {
    name: "drafting",
    host: state.host,
    players: state.players,
    teams: {
      red: { captain: red, members: [] },
      blue: { captain: blue, members: [] },
    },
  };

  const firstPick = getCurrentPick(state.teams);
  if (firstPick === undefined) {
    await interaction.reply({
      content: `invalid state: ${JSON.stringify(state)}`,
    });
    throw new Error("unreachable");
  }
  const captain = state.teams[firstPick].captain;
  await interaction.reply({
    content: `Team captains have been randomly picked. Red: ${
      userMention(
        red,
      )
    }, Blue: ${userMention(blue)}. Drafting has begun. ${
      userMention(
        captain,
      )
    } gets first pick. Use \`/customs team pick\` to choose teammates. The following players are up for draft: ${
      printPool(
        state.players,
      )
    }`,
    ephemeral: true,
  });
}

async function handleCaptainSet(interaction: ChatInputCommandInteraction) {
  if (state.name !== "captains") {
    await interaction.reply({
      content: "You can't pick team captains right now.",
      ephemeral: true,
    });
    return;
  }

  if (state.host !== interaction.user.id) {
    await interaction.reply({
      content: "You are not the host.",
      ephemeral: true,
    });
    return;
  }

  const red = interaction.options.getUser("red", true);
  const blue = interaction.options.getUser("blue", true);

  if (red.id === blue.id) {
    await interaction.reply({
      content: "Team captains must be different users.",
      ephemeral: true,
    });
    return;
  }

  if (!state.players.includes(red.id)) {
    await interaction.reply({
      content: `${userMention(red.id)} is not in the player pool.`,
      ephemeral: true,
    });
    return;
  }

  if (!state.players.includes(blue.id)) {
    await interaction.reply({
      content: `${userMention(blue.id)} is not in the player pool.`,
      ephemeral: true,
    });
    return;
  }

  state.players = state.players.filter((player) => player !== red.id);
  state.players = state.players.filter((player) => player !== blue.id);

  state = {
    name: "drafting",
    host: state.host,
    players: state.players,
    teams: {
      red: { captain: red.id, members: [] },
      blue: { captain: blue.id, members: [] },
    },
  };
  const firstPick = getCurrentPick(state.teams);
  if (firstPick === undefined) {
    await interaction.reply({
      content: `invalid state: ${JSON.stringify(state)}`,
    });
    throw new Error("unreachable");
  }
  const captain = state.teams[firstPick].captain;
  await interaction.reply({
    content: `Team captains have been randomly picked. Red: ${
      userMention(
        red.id,
      )
    }, Blue: ${userMention(blue.id)}. Drafting has begun. ${
      userMention(
        captain,
      )
    } gets first pick. Use \`/customs team pick\` to choose teammates. The following players are up for draft: ${
      printPool(
        state.players,
      )
    }`,
    ephemeral: true,
  });
}

export { customsCommand, handleCustoms };
