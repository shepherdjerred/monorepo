using DSharpPlus.CommandsNext.Entities;
using DSharpPlus.CommandsNext.Converters;
using DSharpPlus.CommandsNext;
using DSharpPlus.Entities;

namespace Impostor.Plugins.ImpostorCord.Discord
{
    public class HelpFormatter : DefaultHelpFormatter
    {
        public HelpFormatter(CommandContext ctx) : base(ctx) { }
        public override CommandHelpMessage Build()
        {
            EmbedBuilder.Color = DiscordColor.SpringGreen;
            return base.Build();
        }

    }
}