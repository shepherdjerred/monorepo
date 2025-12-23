using Impostor.Api.Events.Managers;
using Impostor.Api.Plugins;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.IO;
using Microsoft.Extensions.Logging;
using Impostor.Plugins.ImpostorCord.Handlers;
using Impostor.Plugins.ImpostorCord.Discord;

namespace Impostor.Plugins.ImpostorCord
{
    [ImpostorPlugin(
        package: "com.Tuxinal.ImpostorCord",
        name: "ImpostorCord",
        author: "Tuxinal",
        version: "0.1.7")]
    public class ImpostorCord : PluginBase
    {
        private readonly ILogger<ImpostorCord> _logger;
        private Bot _bot;

        private readonly Config config;
        public ImpostorCord(ILogger<ImpostorCord> logger, IEventManager eventManager)
        {
            _logger = logger;
            string configFile = File.ReadAllText("./config.impostorCord.json");
            config = JsonSerializer.Deserialize<Config>(configFile);

            _bot = new Bot(config);
            eventManager.RegisterListener(new GameEventListener(logger, _bot));
        }

    }
    public class Config
    {
        [JsonPropertyName("token")]
        public string Token { get; set; }

        [JsonPropertyName("prefix")]
        public string Prefix { get; set; }

        [JsonPropertyName("botProxyEnabled")]
        public bool BotProxyEnabled { get; set; }

        [JsonPropertyName("botProxyAddress")]
        public string BotProxyAddress { get; set; }

        [JsonPropertyName("botProxyUsername")]
        public string BotProxyUsername { get; set; }

        [JsonPropertyName("botProxyPassword")]
        public string BotProxyPassword { get; set; }

        [JsonPropertyName("extraSecondsOfTalkAfterMeeting")]
        public uint ExtraSecondsOfTalkAfterMeeting { get; set; }

        [JsonPropertyName("deadСanTalkDuringTasks")]
        public bool DeadСanTalkDuringTasks { get; set; }
        [JsonPropertyName("removeCommands")]
        public bool removeCommands { get; set; }

    }
}