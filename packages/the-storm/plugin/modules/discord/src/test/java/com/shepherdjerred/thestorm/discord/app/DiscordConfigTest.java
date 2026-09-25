package com.shepherdjerred.thestorm.discord.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

final class DiscordConfigTest {

  /** The file the server runs with, relative to this module's directory. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/discord.yml");

  private static Result<DiscordConfig, List<Problem>> parse(String yaml) {
    return StrictYaml.parse("discord.yml", yaml, DiscordConfig.class);
  }

  private static String problems(Result<DiscordConfig, List<Problem>> result) {
    return switch (result) {
      case Result.Ok<DiscordConfig, List<Problem>>(var value) ->
          throw new AssertionError("expected problems, parsed " + value);
      case Result.Err<DiscordConfig, List<Problem>>(var problems) -> problems.toString();
    };
  }

  @Test
  void theShippedFileIsValid() throws Exception {
    var config =
        switch (parse(Files.readString(SHIPPED))) {
          case Result.Ok<DiscordConfig, List<Problem>>(var value) -> value;
          case Result.Err<DiscordConfig, List<Problem>>(var problems) ->
              throw new AssertionError(problems.toString());
        };

    assertThat(config.tokenEnv()).isEqualTo("DISCORD_BOT_TOKEN");
    assertThat(config.channelEnv()).isEqualTo("DISCORD_CHANNEL_ID");
    assertThat(config.messages().start()).isEqualTo("The Storm has woken up");
    assertThat(config.messages().stop()).isEqualTo("The Storm sleeps. Join ts-mc.net to wake it.");
  }

  @Test
  void rejectsSomethingThatIsNotAVariableName() throws Exception {
    var yaml =
        Files.readString(SHIPPED).replace("tokenEnv: DISCORD_BOT_TOKEN", "tokenEnv: \"abc.def\"");

    assertThat(problems(parse(yaml))).contains("environment variable");
  }

  @Test
  void rejectsATemplateMissingItsPlaceholder() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("{player}** joined", "someone** joined");

    assertThat(problems(parse(yaml))).contains("{player}");
  }

  @Test
  void rejectsAnInboundLimitAboveMinecrafts() throws Exception {
    var yaml = Files.readString(SHIPPED).replace("maxInboundLength: 200", "maxInboundLength: 1000");

    assertThat(problems(parse(yaml))).contains("maxInboundLength");
  }
}
