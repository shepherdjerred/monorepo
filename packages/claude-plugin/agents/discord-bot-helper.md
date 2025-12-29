---
description: Discord.js v14 for building Discord bots - slash commands, events, components, embeds, and permissions
when_to_use: When user works with Discord bots, discord.js, slash commands, Discord API, or mentions discord.js patterns
---

# Discord Bot Helper Agent

## What's New in Discord.js v14 (2024-2025)

- **Node.js 22.12+** required (was 16.11+ in early v14)
- **PascalCase enums**: `ButtonStyle.Primary` instead of `'PRIMARY'`
- **Renamed builders**: `EmbedBuilder` (was `MessageEmbed`), `AttachmentBuilder` (was `MessageAttachment`)
- **Display components**: New layout and content elements beyond embeds
- **Gateway v10**: Updated event handling and intents

## Installation

```bash
# Install discord.js
npm install discord.js
# or
bun add discord.js
```

## Basic Bot Setup

### Main File (index.js)

```typescript
import { Client, Events, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // Privileged intent
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}!`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong!');
  }
});

client.login(process.env.DISCORD_TOKEN);
```

## Gateway Intents

Intents control which events your bot receives:

### Common Intents

| Intent | Events Received |
|--------|-----------------|
| `Guilds` | Guild create/update/delete, channels, roles |
| `GuildMembers` | Member join/leave/update (privileged) |
| `GuildMessages` | Message events in guilds |
| `MessageContent` | Message content, attachments, embeds (privileged) |
| `GuildVoiceStates` | Voice channel activity |
| `GuildPresences` | Member presence updates (privileged) |
| `DirectMessages` | DM message events |

### Privileged Intents

Require manual enabling in Discord Developer Portal:
- `GuildMembers`
- `GuildPresences`
- `MessageContent`

```typescript
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,      // Privileged
    GatewayIntentBits.GuildPresences,    // Privileged
    GatewayIntentBits.MessageContent,    // Privileged
  ],
});
```

## Slash Commands

### Command Definition

```typescript
// commands/ping.js
import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Replies with Pong!');

export async function execute(interaction) {
  await interaction.reply('Pong!');
}
```

### Command with Options

```typescript
import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('echo')
  .setDescription('Replies with your input')
  .addStringOption(option =>
    option
      .setName('message')
      .setDescription('The message to echo')
      .setRequired(true)
  )
  .addUserOption(option =>
    option
      .setName('target')
      .setDescription('User to mention')
  )
  .addIntegerOption(option =>
    option
      .setName('count')
      .setDescription('Number of times')
      .setMinValue(1)
      .setMaxValue(10)
  );

export async function execute(interaction) {
  const message = interaction.options.getString('message');
  const target = interaction.options.getUser('target');
  const count = interaction.options.getInteger('count') ?? 1;

  const reply = target
    ? `${target}, ${message.repeat(count)}`
    : message.repeat(count);

  await interaction.reply(reply);
}
```

### Command with Choices

```typescript
export const data = new SlashCommandBuilder()
  .setName('gif')
  .setDescription('Sends a gif')
  .addStringOption(option =>
    option
      .setName('category')
      .setDescription('The gif category')
      .setRequired(true)
      .addChoices(
        { name: 'Funny', value: 'gif_funny' },
        { name: 'Meme', value: 'gif_meme' },
        { name: 'Cute', value: 'gif_cute' },
      )
  );
```

### Subcommands

```typescript
export const data = new SlashCommandBuilder()
  .setName('user')
  .setDescription('User commands')
  .addSubcommand(subcommand =>
    subcommand
      .setName('info')
      .setDescription('Get user info')
      .addUserOption(option =>
        option.setName('target').setDescription('The user')
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('avatar')
      .setDescription('Get user avatar')
      .addUserOption(option =>
        option.setName('target').setDescription('The user')
      )
  );

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const target = interaction.options.getUser('target') ?? interaction.user;

  if (subcommand === 'info') {
    await interaction.reply(`User: ${target.tag}\nID: ${target.id}`);
  } else if (subcommand === 'avatar') {
    await interaction.reply(target.displayAvatarURL({ size: 256 }));
  }
}
```

### Registering Commands

```typescript
// deploy-commands.js
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// Guild commands (instant, for development)
await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  { body: commands.map(c => c.data.toJSON()) }
);

// Global commands (takes up to 1 hour to propagate)
await rest.put(
  Routes.applicationCommands(CLIENT_ID),
  { body: commands.map(c => c.data.toJSON()) }
);
```

### Autocomplete

```typescript
export const data = new SlashCommandBuilder()
  .setName('search')
  .setDescription('Search something')
  .addStringOption(option =>
    option
      .setName('query')
      .setDescription('Search query')
      .setAutocomplete(true)
  );

export async function autocomplete(interaction) {
  const focusedValue = interaction.options.getFocused();

  const choices = ['apple', 'banana', 'cherry', 'date', 'elderberry'];
  const filtered = choices.filter(c => c.startsWith(focusedValue));

  await interaction.respond(
    filtered.slice(0, 25).map(choice => ({ name: choice, value: choice }))
  );
}

export async function execute(interaction) {
  const query = interaction.options.getString('query');
  await interaction.reply(`You searched for: ${query}`);
}
```

## Response Methods

### Basic Responses

```typescript
// Simple reply
await interaction.reply('Hello!');

// Ephemeral reply (only visible to user)
await interaction.reply({ content: 'Secret!', ephemeral: true });

// Deferred reply (for long operations)
await interaction.deferReply();
// ... do work ...
await interaction.editReply('Done!');

// Follow-up messages
await interaction.reply('First message');
await interaction.followUp('Second message');
await interaction.followUp({ content: 'Ephemeral followup', ephemeral: true });
```

### Fetching the Reply

```typescript
const reply = await interaction.fetchReply();
console.log(reply.id);
```

## Embeds

### Creating Embeds

```typescript
import { EmbedBuilder } from 'discord.js';

const embed = new EmbedBuilder()
  .setColor(0x0099FF)
  .setTitle('Embed Title')
  .setURL('https://discord.js.org/')
  .setAuthor({
    name: 'Author Name',
    iconURL: 'https://example.com/icon.png',
    url: 'https://example.com'
  })
  .setDescription('This is the main description')
  .setThumbnail('https://example.com/thumbnail.png')
  .addFields(
    { name: 'Field 1', value: 'Value 1', inline: true },
    { name: 'Field 2', value: 'Value 2', inline: true },
    { name: 'Field 3', value: 'Value 3' },
  )
  .setImage('https://example.com/image.png')
  .setTimestamp()
  .setFooter({ text: 'Footer text', iconURL: 'https://example.com/footer.png' });

await interaction.reply({ embeds: [embed] });
```

### Multiple Embeds

```typescript
const embed1 = new EmbedBuilder().setTitle('Embed 1').setColor(0xFF0000);
const embed2 = new EmbedBuilder().setTitle('Embed 2').setColor(0x00FF00);

await interaction.reply({ embeds: [embed1, embed2] });
```

## Buttons

### Creating Buttons

```typescript
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const row = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('primary')
      .setLabel('Primary')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('secondary')
      .setLabel('Secondary')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('success')
      .setLabel('Success')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('danger')
      .setLabel('Danger')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setLabel('Link')
      .setURL('https://discord.js.org')
      .setStyle(ButtonStyle.Link),
  );

await interaction.reply({ content: 'Click a button!', components: [row] });
```

### Handling Button Clicks

```typescript
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'primary') {
    await interaction.reply('You clicked the primary button!');
  }
});
```

### Disabling Buttons After Click

```typescript
const row = ActionRowBuilder.from(interaction.message.components[0]);
row.components.forEach(button => button.setDisabled(true));

await interaction.update({ components: [row] });
```

## Select Menus

### String Select Menu

```typescript
import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';

const row = new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select')
      .setPlaceholder('Nothing selected')
      .addOptions(
        { label: 'Option 1', description: 'Description 1', value: 'first' },
        { label: 'Option 2', description: 'Description 2', value: 'second' },
        { label: 'Option 3', description: 'Description 3', value: 'third' },
      )
  );

await interaction.reply({ content: 'Select an option!', components: [row] });
```

### Handling Selection

```typescript
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;

  if (interaction.customId === 'select') {
    const selected = interaction.values[0];
    await interaction.reply(`You selected: ${selected}`);
  }
});
```

### User/Role/Channel Select Menus

```typescript
import { UserSelectMenuBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder } from 'discord.js';

const userSelect = new UserSelectMenuBuilder()
  .setCustomId('user-select')
  .setPlaceholder('Select a user')
  .setMinValues(1)
  .setMaxValues(3);

const roleSelect = new RoleSelectMenuBuilder()
  .setCustomId('role-select')
  .setPlaceholder('Select a role');

const channelSelect = new ChannelSelectMenuBuilder()
  .setCustomId('channel-select')
  .setPlaceholder('Select a channel');
```

## Modals (Forms)

### Creating a Modal

```typescript
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

const modal = new ModalBuilder()
  .setCustomId('feedback-modal')
  .setTitle('Feedback Form');

const titleInput = new TextInputBuilder()
  .setCustomId('title')
  .setLabel('Title')
  .setStyle(TextInputStyle.Short)
  .setPlaceholder('Enter a title')
  .setRequired(true)
  .setMaxLength(100);

const descriptionInput = new TextInputBuilder()
  .setCustomId('description')
  .setLabel('Description')
  .setStyle(TextInputStyle.Paragraph)
  .setPlaceholder('Enter your feedback')
  .setRequired(true)
  .setMinLength(10)
  .setMaxLength(1000);

modal.addComponents(
  new ActionRowBuilder().addComponents(titleInput),
  new ActionRowBuilder().addComponents(descriptionInput)
);

// Show modal (must be first response)
await interaction.showModal(modal);
```

### Handling Modal Submission

```typescript
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  if (interaction.customId === 'feedback-modal') {
    const title = interaction.fields.getTextInputValue('title');
    const description = interaction.fields.getTextInputValue('description');

    await interaction.reply(`Feedback received!\nTitle: ${title}\nDescription: ${description}`);
  }
});
```

## Permissions

### Checking Permissions

```typescript
import { PermissionFlagsBits } from 'discord.js';

// Check if member has permission
if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
  // Has admin
}

// Check multiple permissions
if (interaction.member.permissions.has([
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
])) {
  // Has both
}

// Check bot permissions in channel
const botPermissions = interaction.channel.permissionsFor(interaction.client.user);
if (!botPermissions.has(PermissionFlagsBits.SendMessages)) {
  return interaction.reply({ content: 'I cannot send messages here!', ephemeral: true });
}
```

### Setting Default Command Permissions

```typescript
export const data = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban a user')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .setDMPermission(false);  // Disable in DMs
```

### Common Permission Flags

| Flag | Description |
|------|-------------|
| `Administrator` | All permissions |
| `ManageGuild` | Manage server settings |
| `ManageChannels` | Create/delete/modify channels |
| `ManageRoles` | Manage roles below bot's role |
| `ManageMessages` | Delete messages, pin, etc. |
| `KickMembers` | Kick members |
| `BanMembers` | Ban members |
| `SendMessages` | Send messages in channels |
| `EmbedLinks` | Embed links in messages |
| `AttachFiles` | Upload files |
| `MentionEveryone` | Mention @everyone/@here |

## Event Handling

### Event File Structure

```typescript
// events/ready.js
import { Events } from 'discord.js';

export const name = Events.ClientReady;
export const once = true;

export function execute(client) {
  console.log(`Ready! Logged in as ${client.user.tag}`);
}
```

```typescript
// events/interactionCreate.js
import { Events } from 'discord.js';

export const name = Events.InteractionCreate;

export async function execute(interaction) {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const reply = { content: 'There was an error!', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}
```

### Loading Events Dynamically

```typescript
import { readdirSync } from 'fs';
import { join } from 'path';

const eventsPath = join(__dirname, 'events');
const eventFiles = readdirSync(eventsPath).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = await import(join(eventsPath, file));

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}
```

## Sharding

### Basic Sharding Setup

```typescript
// shard.js (entry point)
import { ShardingManager } from 'discord.js';

const manager = new ShardingManager('./bot.js', {
  token: process.env.DISCORD_TOKEN,
  totalShards: 'auto',  // Let Discord determine shard count
});

manager.on('shardCreate', (shard) => {
  console.log(`Launched shard ${shard.id}`);
});

manager.spawn();
```

### Fetching Data Across Shards

```typescript
// Get guild count across all shards
const results = await client.shard.fetchClientValues('guilds.cache.size');
const totalGuilds = results.reduce((acc, count) => acc + count, 0);
```

## Best Practices Summary

1. **Use slash commands** over message-based commands for better UX
2. **Defer replies** for operations taking >3 seconds
3. **Use ephemeral messages** for sensitive or user-specific responses
4. **Check permissions** before performing privileged actions
5. **Handle errors gracefully** with try/catch in command handlers
6. **Use guild commands** for development, global for production
7. **Enable only needed intents** to reduce bandwidth
8. **Use collectors** for time-limited component interactions
9. **Shard your bot** when approaching 2,500 guilds
10. **Store tokens securely** in environment variables

## When to Ask for Help

- Complex permission hierarchies and overwrites
- Voice connection and audio streaming
- Large-scale sharding across multiple processes/machines
- Rate limit handling and optimization
- OAuth2 flows and user authorization
- Webhook management and integration
