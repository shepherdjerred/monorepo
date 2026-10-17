package com.shepherdjerred.mcbridge.adapter.paper;

import static java.util.UUID.randomUUID;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.mcbridge.domain.EventRing;
import com.shepherdjerred.mcbridge.domain.EventType;
import com.shepherdjerred.thestorm.core.safety.ApprovedChatEvent;
import java.lang.reflect.Proxy;
import java.time.InstantSource;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;

final class ApprovedChatCaptureTest {
  private final EventRing ring = new EventRing(10, InstantSource.system());
  private final ApprovedChatCapture capture = new ApprovedChatCapture(new EventCapture(ring));

  private static ApprovedChatEvent publication() {
    var player =
        (Player)
            Proxy.newProxyInstance(
                Player.class.getClassLoader(),
                new Class<?>[] {Player.class},
                (_, method, _) -> {
                  if (method.getName().equals("getName")) return "alice";
                  throw new UnsupportedOperationException(method.getName());
                });
    return new ApprovedChatEvent(player, Component.text("approved hello"), randomUUID());
  }

  @Test
  void deliveredChatProducesOneAttributedChatEvent() {
    var publication = publication();
    publication.markDelivered();
    capture.onChat(publication);
    var events = ring.since(0, 10).events();
    assertThat(events).hasSize(1);
    var event = events.getFirst();
    assertThat(event.type()).isEqualTo(EventType.CHAT);
    assertThat(event.player()).isEqualTo("alice");
    assertThat(event.text()).isEqualTo("approved hello");
  }

  @Test
  void undeliveredChatDoesNotBecomeAPublicationEvent() {
    capture.onChat(publication());
    assertThat(ring.since(0, 10).events()).isEmpty();
  }

  @Test
  void cancelledChatDoesNotBecomeAPublicationEvent() {
    var publication = publication();
    publication.markDelivered();
    publication.setCancelled(true);
    capture.onChat(publication);
    assertThat(ring.since(0, 10).events()).isEmpty();
  }
}
