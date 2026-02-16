# Web Interface

Playing through Discord works, but it's not exactly a great experience. Sending commands through Discord is tedious, especially if only a few people are playing. It takes too long to type commands, especially when you want to cover a large distance. To work around this, Discord Plays Pokémon includes an optional web component that provides a more direct input method to players.

The web interface is hosted on port `8081` by default. Note that this port will need to be open to the public internet if you want others to be able to access this. You can do this by port-forwarding if you are on a home internet connection, or by using something like [Tailscale Funnel](https://tailscale.com/kb/1223/tailscale-funnel/).

Discord is still used to stream audio and video, and commands can still be sent through a Discord text channel. The server will host a publically reachable web page that users can navigate to. The user's commands will be sent directly to the emulator as long as that page is focused.

Gamepad support (e.g. Xbox, PlayStation) controllers will be added in a coming update.
