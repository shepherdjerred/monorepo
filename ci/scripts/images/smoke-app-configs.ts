export const pokemonSmokeConfig = `
server_id = "000000000000000000"

[bot]
enabled = true
discord_token = "smoke-test-dummy-token"
application_id = "000000000000000000"

[bot.commands]
enabled = false
update = false

[bot.commands.screenshot]
enabled = false

[bot.notifications]
channel_id = "000000000000000000"
enabled = false

[stream]
enabled = false
channel_id = "000000000000000000"
dynamic_streaming = false
minimum_in_channel = 0
require_watching = false

[stream.userbot]
id = "000000000000000000"
token = "smoke-test-dummy-selfbot-token"

[stream.video]
scale = 3
frame_rate = 30
bitrate_kbps = 1500
bitrate_max_kbps = 4000

[game]
enabled = false
wasm_path = "packages/backend/assets/pokeemerald.wasm"

[game.commands]
enabled = false
channel_id = "000000000000000000"
max_actions_per_command = 1
max_quantity_per_action = 1
key_press_duration_in_milliseconds = 100
delay_between_actions_in_milliseconds = 100

[game.commands.burst]
duration_in_milliseconds = 100
delay_in_milliseconds = 100
quantity = 1

[game.commands.chord]
duration_in_milliseconds = 100
max_commands = 1
max_total = 1
delay = 100

[game.commands.hold]
duration_in_milliseconds = 100

[web]
enabled = false
cors = false
port = 3000
assets = "/tmp"

[web.api]
enabled = false
`;

export const marioSmokeConfig = `
server_id = "000000000000000000"

[bot]
enabled = false
discord_token = "smoke-test-dummy-token"
application_id = "000000000000000000"

[bot.commands]
enabled = false
update = false

[bot.commands.screenshot]
enabled = false

[bot.notifications]
channel_id = "000000000000000000"
enabled = false

[stream]
enabled = true
channel_id = "000000000000000000"
dynamic_streaming = false
minimum_in_channel = 0
require_watching = false

[stream.userbot]
id = "000000000000000000"
token = "smoke-test-dummy-selfbot-token"

[stream.video]
scale = 2
frame_rate = 30
bitrate_kbps = 1500
bitrate_max_kbps = 4000

[emulator]
enabled = false
wasm_dir = "packages/backend/assets/n64wasm"
rom_path = "roms/mariokart64.z64"
fps = 30
software_render = true
seats = 4

[web]
enabled = false
cors = false
port = 8081
assets = "/tmp"

[web.api]
enabled = false
`;
