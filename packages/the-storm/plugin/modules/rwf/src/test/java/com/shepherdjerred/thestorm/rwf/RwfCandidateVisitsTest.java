package com.shepherdjerred.thestorm.rwf;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.app.RwfFeatures;
import com.shepherdjerred.thestorm.rwf.app.map.MapResources;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Pattern;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryType;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

class RwfCandidateVisitsTest {
  @TempDir Path directory;
  private @Nullable RwfHarness running;

  private RwfHarness start() {
    var harness = RwfHarness.prepare(directory);
    running = harness;
    harness.features = RwfFeatures.ALL;
    secondCandidate();
    return harness.enable(directory);
  }

  private void secondCandidate() {
    try {
      var maps = directory.resolve("rwf/maps");
      var source = maps.resolve("training-yard");
      var target = maps.resolve("other-yard");
      Files.createDirectories(target);
      for (var filename : new String[] {"blocks.schem", "details.json"}) {
        Files.copy(source.resolve(filename), target.resolve(filename));
      }
      var text =
          Files.readString(source.resolve("map.yml"))
              .replace("id: training-yard", "id: other-yard")
              .replace("name: Training Yard", "name: Other Yard");
      var matcher = Pattern.compile("(?<![a-z])x: ([0-9]+(?:\\.[0-9]+)?)").matcher(text);
      var shifted =
          matcher.replaceAll(result -> "x: " + (Double.parseDouble(result.group(1)) + 1024));
      // Integral region/bomb positions are strict integers in YAML.
      shifted = shifted.replaceAll("x: ([0-9]+)\\.0(?=[, }])", "x: $1");
      Files.writeString(target.resolve("map.yml"), shifted);
    } catch (IOException error) {
      throw new UncheckedIOException(error);
    }
  }

  @AfterEach
  void stop() {
    if (running != null) running.close();
  }

  private static void ready(RwfHarness harness) {
    harness.until(
        () ->
            harness.snapshot().ballot().orElseThrow().visits().orElseThrow().readyAt().isPresent());
  }

  private static void click(RwfHarness harness, PlayerMock player, int slot) {
    var event =
        new InventoryClickEvent(
            player.getOpenInventory(),
            InventoryType.SlotType.CONTAINER,
            slot,
            ClickType.LEFT,
            InventoryAction.PICKUP_ALL);
    harness.server.getPluginManager().callEvent(event);
    assertThat(event.isCancelled()).isTrue();
    harness.ticks(2);
  }

  @Test
  void
      visitingKeepsInventoriesAndFlightIndependentOfOtherPlayersAndReturnsBeforeWinnerActivation() {
    var harness = start();
    ready(harness);
    var alice = harness.loadedPlayer("Alice");
    var bob = harness.loadedPlayer("Bob");
    harness.enter(alice);
    harness.enter(bob);
    var activations = new ArrayList<String>();
    var registration =
        harness
            .services
            .require(MapResources.class)
            .register(
                new MapResources.Handler() {
                  @Override
                  public CompletableFuture<Void> prepare(String mapId) {
                    assertThat(alice.getWorld()).isEqualTo(harness.lobbyWorld);
                    assertThat(bob.getWorld()).isEqualTo(harness.lobbyWorld);
                    activations.add(mapId);
                    return CompletableFuture.completedFuture(null);
                  }

                  @Override
                  public void release(String mapId) {}
                });
    try {
      assertThat(harness.snapshot().mapId()).isEmpty();
      alice.performCommand("rwf maps");
      assertThat(alice.getOpenInventory().getTopInventory().getSize()).isEqualTo(45);
      alice.closeInventory();
      alice.performCommand("rwf visit training-yard");
      assertThat(alice.getWorld()).isEqualTo(harness.rwf);
      assertThat(alice.getGameMode()).isEqualTo(GameMode.ADVENTURE);
      assertThat(alice.getAllowFlight()).isTrue();
      assertThat(alice.isFlying()).isTrue();
      assertThat(
              alice.simulateDamage(4, DamageSource.builder(DamageType.FALL).build()).isCancelled())
          .isTrue();
      assertThat(bob.getWorld()).isEqualTo(harness.lobbyWorld);
      assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LOBBY);
      alice.performCommand("rwf maps");
      var trainingIndex =
          harness.snapshot().ballot().orElseThrow().candidates().stream()
              .map(candidate -> candidate.mapId())
              .toList()
              .indexOf("training-yard");
      click(harness, alice, 28 + trainingIndex * 3);
      assertThat(harness.snapshot().ballot().orElseThrow().votes()).hasSize(1);
      alice.closeInventory();
      alice.teleport(new Location(harness.rwf, 1000, -40, 1000));
      harness.ticks(2);
      assertThat(alice.getLocation().getY()).isGreaterThan(0);
      assertThat(alice.getWorld()).isEqualTo(harness.rwf);
      bob.performCommand("rwf visit other-yard");
      assertThat(bob.isFlying()).isTrue();
      assertThat(bob.getLocation().getX()).isGreaterThan(1024);
      assertThat(alice.getLocation().getX()).isLessThan(64);
      harness.tick(Duration.ofSeconds(89));
      assertThat(harness.snapshot().ballot().orElseThrow().closed()).isFalse();
      harness.tick(Duration.ofSeconds(1));
      harness.until(() -> !activations.isEmpty());
      assertThat(activations).containsExactly("training-yard");
      assertThat(alice.isFlying()).isFalse();
      assertThat(bob.isFlying()).isFalse();
    } finally {
      registration.close();
    }
  }

  @Test
  void aWinnerResourceFailureEvacuatesVisitorsAndPublishesStopAndResetWithAdmissionClosed() {
    var harness = start();
    ready(harness);
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    alice.performCommand("rwf visit training-yard");
    assertThat(alice.isFlying()).isTrue();
    var events = new ArrayList<MatchEvent>();
    var watcher = harness.events().subscribe(notification -> events.add(notification.event()));
    var resources =
        harness
            .services
            .require(MapResources.class)
            .register(
                new MapResources.Handler() {
                  @Override
                  public CompletableFuture<Void> prepare(String mapId) {
                    return CompletableFuture.failedFuture(
                        new IllegalStateException("Rejected winner resources"));
                  }

                  @Override
                  public void release(String mapId) {}
                });
    try {
      // The first lobby tick starts the waiting timer; joining alone does not advance the match.
      harness.ticks(1);
      harness.tick(Duration.ofSeconds(91));
      harness.until(() -> events.stream().anyMatch(MatchEvent.ResetDone.class::isInstance));
      assertThat(events).anyMatch(MatchEvent.Stop.class::isInstance);
      assertThat(harness.view().current()).isEmpty();
      assertThat(alice.getWorld()).isEqualTo(harness.overworld);
      assertThat(alice.isFlying()).isFalse();
      assertThat(alice.getAllowFlight()).isFalse();
    } finally {
      resources.close();
      watcher.close();
    }
  }

  @Test
  void abortingAnOpenBallotEvacuatesASpectatorOnCandidateTerrainBeforeReleasingIt() {
    var harness = start();
    ready(harness);
    var visitor = harness.loadedPlayer("Visitor");
    var watcher = harness.loadedPlayer("Watcher");
    harness.enter(visitor);
    visitor.performCommand("rwf visit training-yard");
    watcher.performCommand("rwf spectate");
    harness.until(() -> watcher.getGameMode() == GameMode.SPECTATOR);
    // Explicit terrain-ownership fixture: lobby members are not followable living fighters yet.
    // A spectator already on held terrain must be evacuated on cancel, as on prepare/select.
    watcher.setLocation(visitor.getLocation());
    watcher.setSpectatorTarget(visitor);
    assertThat(watcher.getWorld()).isEqualTo(harness.rwf);
    assertThat(watcher.getSpectatorTarget()).isEqualTo(visitor);

    harness.server.dispatchCommand(harness.server.getConsoleSender(), "rwf admin stop");
    // Check synchronously: a later ballot also evacuates watchers, after old terrain is released.
    assertThat(watcher.getWorld()).isEqualTo(harness.lobbyWorld);
    assertThat(watcher.getSpectatorTarget()).isNull();
    assertThat(watcher.getGameMode()).isEqualTo(GameMode.SPECTATOR);
  }

  @Test
  void leavingOrReturningDuringAVisitClearsGrantedFlight() {
    var harness = start();
    ready(harness);
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    alice.performCommand("rwf visit training-yard");
    assertThat(alice.isFlying()).isTrue();
    alice.performCommand("rwf return");
    assertThat(alice.getWorld()).isEqualTo(harness.lobbyWorld);
    assertThat(alice.getAllowFlight()).isFalse();
    alice.performCommand("rwf visit training-yard");
    alice.performCommand("rwf leave");
    harness.until(() -> alice.getWorld().equals(harness.overworld));
    assertThat(alice.isFlying()).isFalse();
    assertThat(alice.getAllowFlight()).isFalse();
  }
}
