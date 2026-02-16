# Setup Guide

This is **not** very easy to use because there are a lot of components to get this working.

This guide will try to help you set up the bot for your own server.

!!! note

    If you run into any problems following this guide, please [open an issue](https://github.com/shepherdjerred/discord-plays-pokemon/issues). I'll gladly help you out!

## Requirements

- [Docker](https://www.docker.com/products/docker-desktop/)

## Usage without Docker

You can use this without Docker by building this application with `npm install`, `npm run build`, and `./run.sh`.

!!! note

    You will need to have Firefox installed, and possibly other software. You might also still want to have a GPU so that Discord streaming is hardware accelerated.

## Discord Bot Setup

1. Create a Discord application in the [Discord Developer Portal](https://discord.com/developers/applications)
1. Copy the application ID and save it for later
1. Generate a bot token and save the value for later
1. Enable the `MESSAGE CONTENT` intent
1. On the OAuth2 tab, use the URL Generator

Set the following permissions:

- `bot`
- `add reactions`
- `send messages`
- `attach files`
- `embed links`

Copy the URL, open it in another tab, and add the bot to your server.

## Userbot Setup

This section can be skipped if you already have a spare Discord account to use as the streamer (sometimes this is known as a [userbot](https://support.discord.com/hc/en-us/articles/115002192352-Automated-user-accounts-self-bots-))

!!! warning

    Discord does not like user bots. Please be careful.

1. Create a new Discord user just for this application
1. Invite the userbot to your server

## Application Configuration

1. Open up Discord, go to `Settings > Advanced` and turn on `Developer Mode` -- this will make it easier for you to get some values
1. Clone this project somewhere
1. Copy `packages/backend/config.example.toml` to `packages/backend/config.toml`

Edit `packages/backend/config.toml`:

- Set `bot.discord_token` to your BOT TOKEN **Note:** This is _not_ related to your userbot
- Set `stream.userbot.id` to the user ID of your userbot. You can right-click your username and click `Copy User ID` to get this
- Set `stream.userbot.username` to your userbot's username
- Set `stream.userbot.password` to your userbot's password
- Set `bot.application_id` to the value you copied when setting up your bot
- Set `server_id` to the ID of the server you want the bot to join. You can get this by right-clicking your server icon, and selecting `Copy Server ID`
- Set `game.commands.channel_id` to the ID of the text channel you want to use for bot commands. You probably want to make a separate channel just for this. You can get this by right-click your text channel name, and selecting `Copy Channel ID`
- Set `bot.notifications.channel_id` to the ID of the channel you want to use for bot notifications, like when a screenshot is taken, or when the bot starts up.
- Set `stream.channel_id` to the ID of the voice channel you want the game stream to be in.

The other values can be tweaked if desired, but the defaults are probably reasonable.

## Starting the Bot

Put your desired ROM in `packages/frontend/public/roms/`. Edit `packages/frontend/public/emulator.html` with the name of the ROM you want to use -- the default is `liquid_crystal.gba`.

!!! note

    This application only works out-of-the-box with Game Boy Advance ROMs, although it wouldn't be too hard to extend this application for additional systems that EmulatorJS supports.

Run `earthly +up`. This will build the application and start the Docker containers. On your machine, navigate to [http://localhost:8080](http://localhost:8080). Login with the credentials `user` and `password`. This will stream the virtual Linux desktop's screen to your browser, where you can see program execution and interact with the game and Discord application directly.

## Discord Settings

Be sure the Discord is logged into correctly. Sometimes you'll need to solve a captcha, like when you login for the first time, or if you haven't logged in for a while.

Once logged into Discord, the bot should automatically join the voice channel and stream the game. You should make a few changes to the Discord settings.

!!! note

    These settings are _not_ saved, so you'll have to do this every time the application is started. These settings should be changed:

- Output volume should be set to 0%, or there will be an echo
- Soundboard volume should be set to 0%, or there will be an echo
- Automatically determine input sensitivty should be off, and the slider moved as far to the left as possible
- Echo cancellation should be off
- Automatic gain control should be off

After changing these settings, go back to the game window.

## Game Saves

Game saves are stored to the browser storage, which is reset when the application is closed. **SAVING IN-GAME IS NOT ENOUGH!** You need to use the in-game save menu, and then click the "Export Save" in the top-right of the game window. Every time the game is restarted you'll need to click "Import Save" and upload your save file. Be careful to not rely on the in-game save menu by itself! You _must_ do both steps if you want to save your progress. There is _absolutely no way_ to recover your progress if you close the application/Docker container without first saving.

!!! note

    The directory the saves are exported to (`~/Downloads`) is mounted to a Docker volume named `browser-downloads`, so those files will be persisted. It would be a good idea to make a backup of your save files; for example you could send them to your Discord channel after finishing up a session as a failsafe.

## Using the Bot

Okay! After setup is complete, you're ready to go. The bot has the following commands:

- `/help`: Show available chat commands
- `/screenshot`: Take a screenshot and post it to the notifications channel

Run the `/help` command for information about playing games with this bot, such as the controls. That command is generated by the application based on your configured settings and the command bindings, so it will always be up-to-date.

As a quick example, here's what you can do by typing in your text channel

```text
u     # press the 'up' button
5u    # press 'up' five times
a     # press 'a'
a b   # press 'a' then 'b'
start # press 'start'
```

Multiple players can run commands at the same time.
