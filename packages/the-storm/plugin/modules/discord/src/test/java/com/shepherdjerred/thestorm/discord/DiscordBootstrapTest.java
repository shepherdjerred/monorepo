package com.shepherdjerred.thestorm.discord;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;

final class DiscordBootstrapTest {

  @Test
  void acceptsTheTwoRequiredBootstrapValues() {
    var config =
        DiscordBootstrap.fromEnvironment(
            Map.of(
                DiscordBootstrap.TOKEN_ENV,
                "test-token",
                DiscordBootstrap.CHANNEL_ENV,
                "123456789012345678"));

    assertThat(config.channelId()).isEqualTo(123456789012345678L);
  }

  @Test
  void rejectsMissingValuesWithoutEchoingCredentials() {
    assertThatThrownBy(
            () ->
                DiscordBootstrap.fromEnvironment(
                    Map.of(DiscordBootstrap.TOKEN_ENV, "private-test-token")))
        .hasMessageContaining(DiscordBootstrap.CHANNEL_ENV)
        .hasMessageNotContaining("private-test-token");
    assertThatThrownBy(
            () ->
                DiscordBootstrap.fromEnvironment(
                    Map.of(
                        DiscordBootstrap.TOKEN_ENV,
                        "private-test-token",
                        DiscordBootstrap.CHANNEL_ENV,
                        "not-a-channel")))
        .hasMessageContaining(DiscordBootstrap.CHANNEL_ENV)
        .hasMessageNotContaining("private-test-token");
  }
}
