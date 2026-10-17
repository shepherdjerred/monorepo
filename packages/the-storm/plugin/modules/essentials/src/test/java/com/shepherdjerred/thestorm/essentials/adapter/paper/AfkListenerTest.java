package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.safety.ApprovedChatEvent;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.UUID;
import net.kyori.adventure.inventory.Book;
import net.kyori.adventure.text.Component;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class AfkListenerTest {
  private ServerMock server;
  private PlayerMock player;
  private AfkTracker afk;

  @BeforeEach
  void open() {
    server = MockBukkit.mock();
    var plugin = MockBukkit.createMockPlugin();
    player = server.addPlayer();
    var time = InstantSource.fixed(Instant.parse("2026-10-16T12:00:00Z"));
    var analytics = ProductAnalytics.disabled();
    afk = new AfkTracker(time, Duration.ofMinutes(5), analytics);
    afk.joined(player.getUniqueId());
    afk.toggle(player.getUniqueId());
    var runtime =
        new PaperRuntime(
            server, new PaperScheduler(plugin), time, plugin.getComponentLogger(), analytics);
    var book =
        Book.book(
            Component.text("Rules"), Component.text("Storm"), List.of(Component.text("Page")));
    var listener = new AfkListener(runtime, afk, new PlayerCommands(runtime, book, book, afk));
    server.getPluginManager().registerEvents(listener, plugin);
  }

  @AfterEach
  void close() {
    MockBukkit.unmock();
  }

  private ApprovedChatEvent publication() {
    return new ApprovedChatEvent(player, Component.text("hello"), UUID.randomUUID());
  }

  @Test
  void deliveredApprovedChatBringsAnAwayPlayerBack() {
    var event = publication();
    event.markDelivered();
    server.getPluginManager().callEvent(event);
    assertThat(afk.isAfk(player.getUniqueId())).isFalse();
  }

  @Test
  void undeliveredChatDoesNotInventActivity() {
    server.getPluginManager().callEvent(publication());
    assertThat(afk.isAfk(player.getUniqueId())).isTrue();
  }

  @Test
  void cancelledChatKeepsExistingAfkSemantics() {
    var event = publication();
    event.markDelivered();
    event.setCancelled(true);
    server.getPluginManager().callEvent(event);
    assertThat(afk.isAfk(player.getUniqueId())).isTrue();
  }
}
