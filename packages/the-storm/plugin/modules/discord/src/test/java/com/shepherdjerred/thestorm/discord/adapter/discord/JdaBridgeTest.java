package com.shepherdjerred.thestorm.discord.adapter.discord;

import static org.assertj.core.api.Assertions.assertThat;

import net.dv8tion.jda.api.entities.Message;
import net.dv8tion.jda.api.utils.messages.MessageCreateBuilder;
import org.junit.jupiter.api.Test;

final class JdaBridgeTest {
  @Test
  void feedPayloadSuppressesNotificationsAndMentionsWithoutChangingContent() {
    var content = "@everyone <@123456789012345678> The Storm has woken up";
    var payload =
        JdaBridge.quietMessage(new MessageCreateBuilder().setContent(content)).build().toData();

    assertThat(payload.getInt("flags") & Message.MessageFlag.NOTIFICATIONS_SUPPRESSED.getValue())
        .isNotZero();
    assertThat(payload.getObject("allowed_mentions").getArray("parse").length()).isZero();
    assertThat(payload.getString("content")).isEqualTo(content);
  }

  @Test
  void lobbyPingNotifiesOnlyTheListedRoles() {
    var payload =
        JdaBridge.rolePing(
                new MessageCreateBuilder().setContent("<@&123456789012345678> lobby open"),
                java.util.List.of("123456789012345678"))
            .build()
            .toData();

    assertThat(payload.getInt("flags") & Message.MessageFlag.NOTIFICATIONS_SUPPRESSED.getValue())
        .isZero();
    var mentions = payload.getObject("allowed_mentions");
    assertThat(mentions.getArray("parse").length()).isZero();
    assertThat(mentions.getArray("roles").getString(0)).isEqualTo("123456789012345678");
    assertThat(mentions.hasKey("users") ? mentions.getArray("users").length() : 0).isZero();
  }

  @Test
  void townPageRegistrationBoundsTheListenersIntegerConversion() {
    var option = JdaBridge.townPageOption().toData();
    assertThat(option.getLong("min_value")).isEqualTo(1);
    assertThat(option.getLong("max_value")).isEqualTo(Integer.MAX_VALUE);
  }
}
