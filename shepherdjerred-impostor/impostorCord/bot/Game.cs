using DSharpPlus.Entities;

namespace Impostor.Plugins.ImpostorCord.Discord
{
    public class Game
    {
        public DiscordChannel gameStartingChannel; // storing the channel that the game started in
        public DiscordChannel voiceChannel;
        public DiscordMessage startMessage;
        public Player[] players;
        public bool DeadСanTalkDuringTasks = true;

        public Game(){
            players = new [] {
                //TODO optimize
                new Player(this), // red
                new Player(this), // blue
                new Player(this), // green
                new Player(this), // pink
                new Player(this), // orange
                new Player(this), // yellow
                new Player(this), // black
                new Player(this), // white
                new Player(this), // purple
                new Player(this), // brown
                new Player(this), // cyan
                new Player(this)  // lime
            };
        }
    }
    public class Player
    {
        public bool isDead = false;
        public bool isMute = false;
        public bool isDeaf = false;
        public DiscordMember uid;
        public Game game;
        public Player(Game game) {
            this.game = game;
        }
    }
}