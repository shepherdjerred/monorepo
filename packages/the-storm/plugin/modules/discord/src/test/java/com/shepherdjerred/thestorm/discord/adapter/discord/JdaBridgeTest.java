package com.shepherdjerred.thestorm.discord.adapter.discord;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import net.dv8tion.jda.api.entities.Message;
import net.dv8tion.jda.api.utils.messages.MessageCreateBuilder;
import org.junit.jupiter.api.Test;
import org.slf4j.helpers.NOPLogger;

final class JdaBridgeTest {
  private static final class FakeTransport implements JdaBridge.TrackedTransport {
    private record PendingSend(String text, Consumer<JdaBridge.SentMessage> onSent) {}

    final ArrayDeque<PendingSend> pendingSends = new ArrayDeque<>();
    final List<Long> deletedById = new ArrayList<>();
    final List<Long> deletedOnAck = new ArrayList<>();
    boolean connected = true;

    @Override
    public boolean sendTracked(
        String text, Consumer<JdaBridge.SentMessage> onSent, Consumer<Throwable> onError) {
      if (!connected) return false;
      pendingSends.addLast(new PendingSend(text, onSent));
      return true;
    }

    @Override
    public boolean deleteById(long messageId, Runnable onSuccess, Consumer<Throwable> onError) {
      if (!connected) return false;
      deletedById.add(messageId);
      onSuccess.run();
      return true;
    }

    void ackNext(long discordMessageId) {
      var send = pendingSends.removeFirst();
      send.onSent()
          .accept(
              new JdaBridge.SentMessage() {
                @Override
                public long idLong() {
                  return discordMessageId;
                }

                @Override
                public void delete(Runnable onSuccess, Consumer<Throwable> onError) {
                  deletedOnAck.add(discordMessageId);
                  onSuccess.run();
                }
              });
    }
  }

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
                List.of("123456789012345678"))
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

  @Test
  void retractsTrackedMessageAfterDiscordAcknowledgesSend() {
    var transport = new FakeTransport();
    var bridge = new JdaBridge(NOPLogger.NOP_LOGGER, transport);
    var submissionId = UUID.randomUUID();

    bridge.postTracked(submissionId, "**Alice**: hello");
    transport.ackNext(4201L);
    assertThat(transport.deletedById).isEmpty();
    assertThat(transport.deletedOnAck).isEmpty();

    bridge.retract(submissionId);
    assertThat(transport.deletedById).containsExactly(4201L);
    assertThat(bridge.trackedMessageCount()).isZero();
  }

  @Test
  void retractsTrackedMessageImmediatelyUponAckWhenRetractionArrivesFirst() {
    var transport = new FakeTransport();
    var bridge = new JdaBridge(NOPLogger.NOP_LOGGER, transport);
    var submissionId = UUID.randomUUID();

    bridge.postTracked(submissionId, "**Alice**: fast block");
    bridge.retract(submissionId);
    assertThat(transport.deletedById).isEmpty();
    assertThat(transport.deletedOnAck).isEmpty();
    assertThat(bridge.pendingRetractionCount()).isEqualTo(1);

    transport.ackNext(7777L);
    assertThat(transport.deletedOnAck).containsExactly(7777L);
    assertThat(transport.deletedById).isEmpty();
    assertThat(bridge.pendingRetractionCount()).isZero();
    assertThat(bridge.trackedMessageCount()).isZero();
  }

  @Test
  void trackedMapsEvictOldestEntriesAtTwoHundredFiftySixBound() {
    var transport = new FakeTransport();
    var bridge = new JdaBridge(NOPLogger.NOP_LOGGER, transport);
    var oldest = UUID.randomUUID();
    bridge.postTracked(oldest, "oldest");
    transport.ackNext(1000L);

    UUID newest = oldest;
    for (var i = 1; i <= JdaBridge.MAX_TRACKED_MESSAGES; i++) {
      newest = UUID.randomUUID();
      bridge.postTracked(newest, "msg " + i);
      transport.ackNext(1000L + i);
    }
    assertThat(bridge.trackedMessageCount()).isEqualTo(JdaBridge.MAX_TRACKED_MESSAGES);

    bridge.retract(oldest);
    assertThat(transport.deletedById).isEmpty();

    bridge.retract(newest);
    assertThat(transport.deletedById).containsExactly(1000L + JdaBridge.MAX_TRACKED_MESSAGES);

    for (var i = 0; i < JdaBridge.MAX_TRACKED_MESSAGES + 10; i++) {
      bridge.retract(UUID.randomUUID());
    }
    assertThat(bridge.pendingRetractionCount()).isEqualTo(JdaBridge.MAX_TRACKED_MESSAGES);
  }
}
