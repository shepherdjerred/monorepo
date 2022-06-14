using Microsoft.Extensions.Logging;
using Impostor.Api.Events;
using Impostor.Api.Events.Meeting;
using Impostor.Api.Events.Player;
using Impostor.Plugins.ImpostorCord.Discord;


namespace Impostor.Plugins.ImpostorCord.Handlers
{
    public class GameEventListener : IEventListener
    {
        private readonly ILogger<ImpostorCord> _logger;
        private Bot _bot;

        public GameEventListener(ILogger<ImpostorCord> logger, Bot bot)
        {
            _logger = logger;
            _bot = bot;
        }
        [EventListener]
        public async void OnMeetingStarted(IMeetingStartedEvent e)
        {
            foreach (var player in e.Game.Players)
            {
                if(player.Character.PlayerInfo.IsDead){
                    Bot.games[e.Game.Code.Code].players[player.Character.PlayerInfo.ColorId].isDead = true;
                }
            }
            await Bot.Meeting(e.Game.Code.Code);
        }
        [EventListener]
        public async void OnMeetingEnded(IMeetingEndedEvent e)
        {
            if(Bot.config.ExtraSecondsOfTalkAfterMeeting>0)
            {
                await System.Threading.Tasks.Task.Delay(System.TimeSpan.FromSeconds(Bot.config.ExtraSecondsOfTalkAfterMeeting));
            }

            if(e.Game.GameState==Api.Innersloth.GameStates.Started)
                await Bot.Tasks(e.Game.Code.Code);
        }
        [EventListener]
        public async void OnGameStarted(IGameStartedEvent e)
        {
            await Bot.Tasks(e.Game.Code.Code);

        }

        [EventListener]
        public async void OnGameEnded(IGameEndedEvent e)
        {
            await Bot.Lobby(e.Game.Code.Code);
        }
        [EventListener]
        public void OnGameCreated(IGameCreatedEvent e)
        {
            Bot.games.Add(e.Game.Code.Code,new Game {DeadСanTalkDuringTasks=Bot.config.DeadСanTalkDuringTasks} );
        }
        [EventListener]
        public void OnGameDestroyed(IGameDestroyedEvent e)
        {
            Bot.games.Remove(e.Game.Code.Code);
        }
        [EventListener]
        public void OnPlayerExhiled(IPlayerExileEvent e){
            Bot.games[e.Game.Code.Code].players[e.PlayerControl.PlayerInfo.ColorId].isDead = true;
        }

    }
}