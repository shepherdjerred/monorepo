using System;
using System.Linq;
using System.Threading.Tasks;
using Impostor.Api.Events;
using Impostor.Api.Events.Player;
using Impostor.Api.Innersloth;

namespace Commands.ShepherdJerred {
    // ReSharper disable once UnusedType.Global
    public class CommandListener : IEventListener {
        [EventListener]
        // ReSharper disable once UnusedMember.Global
        public async ValueTask OnPlayerChat(IPlayerChatEvent chatEvent) {
            var message = chatEvent.Message;

            if (message.ElementAtOrDefault(0) == '/') await HandleCommand(chatEvent);
        }

        private async Task HandleCommand(IPlayerChatEvent chatEvent) {
            var message = chatEvent.Message;
            var parts = message.ToLowerInvariant()[1..].Split(" ");
            
            var command = parts.ElementAtOrDefault(0);

            switch (command) {
                case "help":
                    await HandleHelpCommand(chatEvent);
                    break;
                case "settings":
                    await HandleSettingsCommand(chatEvent);
                    break;
                default:
                    await chatEvent.PlayerControl.SendChatToPlayerAsync(
                        $"Unknown command \"{command}\". Valid commands are /help and /settings.");
                    break;
            }
        }

        private async Task HandleHelpCommand(IPlayerChatEvent chatEvent) {
            await chatEvent.PlayerControl.SendChatToPlayerAsync("/help: show this\n/settings: edit game settings");
        }

        private async Task HandleSettingsCommand(IPlayerChatEvent chatEvent) {
            var message = chatEvent.Message;
            var parts = message.ToLowerInvariant()[1..].Split(" ");
            
            if (parts.Length < 1) {
                await chatEvent.PlayerControl.SendChatToPlayerAsync("No argument given");
                return;
            }

            var firstArgument = parts.ElementAtOrDefault(1);
            
            if (!chatEvent.ClientPlayer.IsHost) {
                await chatEvent.PlayerControl.SendChatToPlayerAsync("This command can only be run by the host");
                return;
            }

            if (chatEvent.Game.GameState != GameStates.NotStarted) {
                await chatEvent.PlayerControl.SendChatToPlayerAsync("This command can only be run before the game is started.");
                return;
            }

            switch (firstArgument) {
                case "map":
                    await HandleSettingsMapCommand(chatEvent);
                    break;
                case "imposters":
                    await HandleSettingsImpostersCommand(chatEvent);
                    break;
                default:
                    await chatEvent.PlayerControl.SendChatToPlayerAsync(
                        $"Unknown argument \"{firstArgument}\". Valid arguments are map and imposters, i.e. /settings map or /settings imposters.");
                    break; 
            }
        }

        private async Task HandleSettingsMapCommand(IPlayerChatEvent chatEvent) {
            var message = chatEvent.Message;
            var parts = message.ToLowerInvariant()[1..].Split(" ");

            var secondArgument = parts.ElementAtOrDefault(2);

            var mapNames = Enum.GetNames(typeof(MapTypes));

            if (mapNames.Any(mapName => mapName.ToLowerInvariant() == secondArgument)) {
                var map = Enum.Parse<MapTypes>(secondArgument, true);

                await chatEvent.PlayerControl.SendChatAsync($"Setting map to {secondArgument}");
                
                chatEvent.Game.Options.Map = map;
                await chatEvent.Game.SyncSettingsAsync();
            } else {
                await chatEvent.PlayerControl.SendChatToPlayerAsync(
                    $"Unknown map \"{secondArgument}\". Valid maps are {string.Join(", ", mapNames)}");
            }
        }
        
        private async Task HandleSettingsImpostersCommand(IPlayerChatEvent chatEvent) {
            var message = chatEvent.Message;
            var parts = message.ToLowerInvariant()[1..].Split(" ");

            var secondArgument = parts.ElementAtOrDefault(2);

            if (int.TryParse(secondArgument, out int num)) {
                if (num > 3 || num < 1) {
                    await chatEvent.PlayerControl
                        .SendChatToPlayerAsync($"Invalid argument \"{num}\". Value must be between 1-3");
                    return;
                }

                await chatEvent.PlayerControl.SendChatAsync($"Setting number of imposters to {num}");
                chatEvent.Game.Options.NumImpostors = num;

                await chatEvent.Game.SyncSettingsAsync();
            }
        }
    }
}