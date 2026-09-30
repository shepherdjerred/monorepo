package com.shepherdjerred.thestorm.world.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.world.app.DailyLedger;
import com.shepherdjerred.thestorm.world.domain.DailyReport;
import com.shepherdjerred.thestorm.world.domain.DigestConfig;
import java.time.Instant;
import java.time.InstantSource;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

final class DailyActivityListenerTest {

  private ServerMock server;
  private WorldMock world;
  private WorldMock wilds;
  private PlayerMock player;
  private RecordingLedger ledger;
  private DailyActivityListener listener;

  @BeforeEach
  void setUp() {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    wilds = server.addSimpleWorld("wilds");
    player = server.addPlayer();
    ledger = new RecordingLedger();
    listener =
        new DailyActivityListener(
            new DigestConfig(true, "world", "America/Los_Angeles"),
            InstantSource.fixed(Instant.parse("2026-09-27T06:30:00Z")),
            ledger,
            ComponentLogger.logger("daily-activity-test"));
  }

  @AfterEach
  void tearDown() {
    MockBukkit.unmock();
  }

  @Test
  void recordsOnlyMainWorldArrivalsAndDeathsOnPacificDate() {
    player.teleport(world.getSpawnLocation());
    listener.onJoin(new PlayerJoinEvent(player, Component.empty()));
    listener.onWorldChange(new PlayerChangedWorldEvent(player, wilds));
    listener.onDeath(death());

    assertThat(ledger.arrivals)
        .containsExactly(
            new Arrival(LocalDate.of(2026, 9, 26), player.getUniqueId()),
            new Arrival(LocalDate.of(2026, 9, 26), player.getUniqueId()));
    assertThat(ledger.deaths).containsExactly(LocalDate.of(2026, 9, 26));

    player.teleport(wilds.getSpawnLocation());
    listener.onJoin(new PlayerJoinEvent(player, Component.empty()));
    listener.onWorldChange(new PlayerChangedWorldEvent(player, world));
    listener.onDeath(death());
    assertThat(ledger.arrivals).hasSize(2);
    assertThat(ledger.deaths).hasSize(1);
  }

  private PlayerDeathEvent death() {
    return new PlayerDeathEvent(
        player,
        DamageSource.builder(DamageType.GENERIC).build(),
        new ArrayList<>(),
        0,
        Component.empty(),
        false);
  }

  private record Arrival(LocalDate date, UUID player) {}

  private static final class RecordingLedger implements DailyLedger {
    final ArrayList<Arrival> arrivals = new ArrayList<>();
    final ArrayList<LocalDate> deaths = new ArrayList<>();

    @Override
    public CompletableFuture<Void> recordArrival(LocalDate date, UUID player, Instant at) {
      arrivals.add(new Arrival(date, player));
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<Void> recordDeath(LocalDate date, Instant at) {
      deaths.add(date);
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<Optional<DailyReport>> read(LocalDate date) {
      return CompletableFuture.completedFuture(Optional.empty());
    }
  }
}
