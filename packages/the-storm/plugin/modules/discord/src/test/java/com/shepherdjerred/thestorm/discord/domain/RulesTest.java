package com.shepherdjerred.thestorm.discord.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class RulesTest {

  private static final String TOKEN = "super.secret.token";
  private static final String ELLIPSIS = String.valueOf((char) 0x2026);

  @Test
  void relaysPeopleButNotBots() {
    assertThat(InboundFilter.accept(new InboundMessage("Jerred", "hi all", false, 0), 100))
        .isEqualTo(Result.ok(new InboundFilter.Relayed("Jerred", "hi all")));
    assertThat(InboundFilter.accept(new InboundMessage("Bridge", "hi", true, 0), 100))
        .isEqualTo(Result.err(InboundFilter.Skip.AUTOMATED));
  }

  @Test
  void describesAttachmentsAndSkipsEmptyMessages() {
    assertThat(InboundFilter.accept(new InboundMessage("J", "", false, 2), 100))
        .isEqualTo(Result.ok(new InboundFilter.Relayed("J", "[attachment]")));
    assertThat(InboundFilter.accept(new InboundMessage("J", "look", false, 1), 100))
        .isEqualTo(Result.ok(new InboundFilter.Relayed("J", "look [attachment]")));
    assertThat(InboundFilter.accept(new InboundMessage("J", " **** ", false, 0), 100))
        .isEqualTo(Result.err(InboundFilter.Skip.EMPTY));
    assertThat(InboundFilter.accept(new InboundMessage(" ", "hi", false, 0), 100))
        .isEqualTo(Result.err(InboundFilter.Skip.NAMELESS));
  }

  @Test
  void cutsLongMessagesAndNames() {
    var relayed =
        InboundFilter.accept(new InboundMessage("n".repeat(40), "x".repeat(300), false, 0), 10);

    assertThat(relayed)
        .isEqualTo(
            Result.ok(
                new InboundFilter.Relayed("n".repeat(31) + ELLIPSIS, "x".repeat(9) + ELLIPSIS)));
  }

  @Test
  void templatesNeedTheirPlaceholdersAndFillInOnePass() {
    assertThatThrownBy(() -> new MessageTemplate("{player} joined", List.of("player", "message")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("{message}");
    assertThatThrownBy(() -> new MessageTemplate(" ", List.of()))
        .isInstanceOf(IllegalArgumentException.class);

    var template =
        new MessageTemplate("**{player}**: {message} {other", List.of("player", "message"));

    assertThat(template.render(Map.of("player", "{message}", "message", "hi")))
        .isEqualTo("**{message}**: hi {other");
    assertThatThrownBy(() -> template.render(Map.of("player", "x")))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void onlyRealAnnouncedAdvancementsArePosted() {
    assertThat(Advancements.shouldPost("story/mine_stone", true, true)).isTrue();
    assertThat(Advancements.shouldPost("story/mine_stone", true, false)).isFalse();
    assertThat(Advancements.shouldPost("recipes/misc/torch", false, false)).isFalse();
    assertThat(Advancements.shouldPost("recipes/custom", true, true)).isFalse();
    assertThat(Advancements.shouldPost("husbandry/root", false, true)).isFalse();
  }

  @Test
  void listsPlayersSortedAndEscaped() {
    var list = new MessageTemplate("Online ({count}): {players}", List.of("count", "players"));
    var empty = new MessageTemplate("Nobody is online.", List.of());

    assertThat(PlayerList.format(List.of("zed", "Alice", "under_score"), list, empty))
        .isEqualTo("Online (3): Alice, under\\_score, zed");
    assertThat(PlayerList.format(List.of(), list, empty)).isEqualTo("Nobody is online.");
  }

  @Test
  void readsCredentialsFromTheEnvironment() {
    var env = Map.of("TOKEN", "  " + TOKEN + " ", "CHANNEL", "123456789012345678");

    assertThat(
            DiscordCredentials.resolve(
                "TOKEN", "CHANNEL", name -> Optional.ofNullable(env.get(name))))
        .isEqualTo(Result.ok(new DiscordCredentials(TOKEN, 123_456_789_012_345_678L)));
  }

  @Test
  void listsEveryMissingOrMalformedVariableWithoutLeakingValues() {
    var missing = DiscordCredentials.resolve("TOKEN", "CHANNEL", name -> Optional.empty());
    var badChannel =
        DiscordCredentials.resolve(
            "TOKEN", "CHANNEL", name -> Optional.of(name.equals("TOKEN") ? TOKEN : "general"));
    var hugeChannel =
        DiscordCredentials.resolve(
            "TOKEN",
            "CHANNEL",
            name -> Optional.of(name.equals("TOKEN") ? TOKEN : "99999999999999999999"));
    var blankToken =
        DiscordCredentials.resolve(
            "TOKEN", "CHANNEL", name -> Optional.of(name.equals("TOKEN") ? " " : "1"));

    assertThat(missing)
        .isEqualTo(
            Result.err(
                List.of(
                    "environment variable TOKEN (the bot token) is not set",
                    "environment variable CHANNEL (the channel id) is not set")));
    assertThat(badChannel)
        .isEqualTo(Result.err(List.of("environment variable CHANNEL is not a Discord channel id")));
    assertThat(hugeChannel.isOk()).isFalse();
    assertThat(blankToken)
        .isEqualTo(Result.err(List.of("environment variable TOKEN (the bot token) is not set")));
    assertThat(badChannel.toString()).doesNotContain(TOKEN);
  }

  @Test
  void credentialsNeverPrintTheToken() {
    var credentials = new DiscordCredentials(TOKEN, 42);

    assertThat(credentials.toString()).doesNotContain(TOKEN).contains("42");
    assertThatThrownBy(() -> new DiscordCredentials(TOKEN, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
