package com.shepherdjerred.thestorm.discord;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.discord.app.DiscordConfig;
import com.shepherdjerred.thestorm.discord.app.DiscordMessages;
import com.shepherdjerred.thestorm.discord.app.LobbyPing;
import com.shepherdjerred.thestorm.discord.app.Milestones;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class DiscordModuleTest {

  private static final String TOKEN = "never.print.me";
  private static final DiscordConfig CONFIG =
      new DiscordConfig(
          "DISCORD_BOT_TOKEN",
          "DISCORD_CHANNEL_ID",
          "Awake",
          "D",
          200,
          new DiscordMessages(
              "{player}: {message}",
              "{player} joined",
              "{player} left",
              "{message}",
              "{player} {advancement}",
              "up",
              "down",
              "{count}: {players}",
              "nobody",
              "Ticket #{id} [{server}/{priority}] {category} from **{reporter}**: {summary}",
              "Ticket #{id} [{server}] claimed by **{staff}**",
              "Ticket #{id} [{server}] resolved by **{staff}**",
              "Ticket #{id} [{server}/{priority}] needs a human: {summary}",
              "Ticket #{id} [{server}] reopened",
              "Ticket #{id} [{server}] triaged [{priority}]: {evidence}",
              "**{player}** opened a Search and Destroy lobby",
              "{map}: **{team}** won in {duration}. GG {winners}",
              "{map}: draw after {duration}: {players}",
              "**{player}** opened {arena}",
              "{arena} boss wave {wave}: {boss}",
              "{arena} ({tier}) over at {wave}: {players}",
              "{arena} ({tier}) record {wave}: {players}",
              "**{player}** founded {town}",
              "{town} claims {claims}",
              "**{player}** completed {quest}",
              "**{player}** {skill} {level}",
              "{event} until {until}"),
          new LobbyPing(List.of(), 30),
          new Milestones(List.of(25, 50), 100));

  @Test
  void refusesToStartWithoutSecrets() {
    assertThatThrownBy(() -> DiscordModule.credentials(CONFIG, name -> Optional.empty()))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("DISCORD_BOT_TOKEN")
        .hasMessageContaining("DISCORD_CHANNEL_ID")
        .hasMessageContaining("config.yml");
  }

  @Test
  void neverPutsTheTokenInTheError() {
    var env = Map.of("DISCORD_BOT_TOKEN", TOKEN, "DISCORD_CHANNEL_ID", "general");

    assertThatThrownBy(
            () -> DiscordModule.credentials(CONFIG, name -> Optional.ofNullable(env.get(name))))
        .hasMessageContaining("not a Discord channel id")
        .message()
        .doesNotContain(TOKEN);
  }

  @Test
  void readsWiredSecrets() {
    var env = Map.of("DISCORD_BOT_TOKEN", TOKEN, "DISCORD_CHANNEL_ID", "42");

    var credentials = DiscordModule.credentials(CONFIG, name -> Optional.ofNullable(env.get(name)));

    assertThat(credentials.channelId()).isEqualTo(42);
    assertThat(new DiscordModule().id()).isEqualTo("discord");
  }
}
