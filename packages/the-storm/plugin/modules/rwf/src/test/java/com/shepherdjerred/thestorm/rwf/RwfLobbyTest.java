package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyBuild;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.damage.DamageSource;
import org.bukkit.damage.DamageType;
import org.bukkit.entity.Entity;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.entity.TextDisplay;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.persistence.PersistentDataType;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The lobby room on MockBukkit: enabling pastes and dresses it once, joining lands at its spawn
 * with the countdown boss bar, nothing hurts and nothing breaks inside it, falling out puts a
 * player back, and going live takes everyone to the map and the bar away.
 */
final class RwfLobbyTest {

  private static final NamespacedKey LOBBY_TAG = new NamespacedKey("thestorm", "rwf_lobby");

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  private RwfHarness start() {
    running = RwfHarness.start(directory);
    return running;
  }

  private static boolean inLobby(PlayerMock player) {
    return LobbyBuild.layout().contains(vec(player.getLocation()));
  }

  private static Vec3 vec(Location at) {
    return new Vec3(at.getX(), at.getY(), at.getZ());
  }

  private static List<String> lobbyParts(RwfHarness harness) {
    var parts = new ArrayList<String>();
    for (var entity : harness.rwf.getEntities()) {
      var part = entity.getPersistentDataContainer().get(LOBBY_TAG, PersistentDataType.STRING);
      if (part != null) {
        parts.add(part);
      }
    }
    return parts;
  }

  private static List<String> barNames(PlayerMock player) {
    var names = new ArrayList<String>();
    for (BossBar bar : player.activeBossBars()) {
      names.add(PlainTextComponentSerializer.plainText().serialize(bar.name()));
    }
    return names;
  }

  @Test
  void enablingPastesTheRoomAndDressesItWithRulesABoardAndAnAlcovePerKit() {
    var harness = start();
    var spawn = LobbyBuild.layout().spawn().position().toBlock();

    assertThat(harness.rwf.getBlockAt(spawn.x(), spawn.y() - 1, spawn.z()).getType())
        .isEqualTo(Material.GOLD_BLOCK);
    assertThat(lobbyParts(harness))
        .containsExactlyInAnyOrder(
            "rules",
            "board",
            "alcove-item:trooper",
            "alcove-label:trooper",
            "alcove-item:longbow",
            "alcove-label:longbow",
            "alcove-item:shortbow",
            "alcove-label:shortbow",
            "alcove-item:rewind",
            "alcove-label:rewind");
    assertThat(harness.rwf.getEntitiesByClass(ItemDisplay.class))
        .extracting(display -> display.getItemStack().getType())
        .containsExactlyInAnyOrder(
            Material.IRON_SWORD, Material.BOW, Material.ARROW, Material.CLOCK);
    assertThat(harness.rwf.getEntities()).allMatch(entity -> !entity.isPersistent());
  }

  @Test
  void displaysLeftByACrashAreSweptSoNoneIsDuplicatedAndDisablingRemovesThem() {
    var harness = RwfHarness.prepare(directory);
    running = harness;
    var stale = LobbyBuild.layout().rules().position();
    harness.rwf.spawn(
        new Location(harness.rwf, stale.x(), stale.y(), stale.z()),
        TextDisplay.class,
        display ->
            display
                .getPersistentDataContainer()
                .set(LOBBY_TAG, PersistentDataType.STRING, "rules"));

    harness.enable(directory);

    assertThat(lobbyParts(harness).stream().filter("rules"::equals)).hasSize(1);
    assertThat(lobbyParts(harness)).hasSize(10);
    harness.disable();
    assertThat(lobbyParts(harness)).isEmpty();
  }

  @Test
  void joiningLandsAtTheLobbySpawnWithTheCountdownBar() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");

    harness.enter(alice);

    var spawn = LobbyBuild.layout().spawn().position();
    assertThat(vec(alice.getLocation()).distanceTo(spawn)).isLessThan(0.01);
    assertThat(inLobby(alice)).isTrue();
    harness.until(
        () -> barNames(alice).stream().anyMatch(name -> name.startsWith("Match starts in")));
    harness.ticks(5);
    var board = boardText(harness);
    assertThat(board).contains("Map: Training Yard").contains("Players: 1").contains("Starting in");
  }

  private static String boardText(RwfHarness harness) {
    for (Entity entity : harness.rwf.getEntities()) {
      if (entity instanceof TextDisplay display
          && "board"
              .equals(
                  entity.getPersistentDataContainer().get(LOBBY_TAG, PersistentDataType.STRING))) {
        return PlainTextComponentSerializer.plainText().serialize(display.text());
      }
    }
    throw new AssertionError("no match board");
  }

  @Test
  void nothingHurtsOrBreaksInTheLobbyAndFallingOutPutsAPlayerBack() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);

    var fall = alice.simulateDamage(4, DamageSource.builder(DamageType.FALL).build());
    assertThat(fall.isCancelled()).isTrue();

    var floor = alice.getLocation().clone().add(0, -1, 0).getBlock();
    var breaking = new BlockBreakEvent(floor, alice);
    harness.server.getPluginManager().callEvent(breaking);
    assertThat(breaking.isCancelled()).isTrue();
    assertThat(floor.getType()).isEqualTo(Material.GOLD_BLOCK);

    alice.teleport(alice.getLocation().clone().add(0, -20, 0));
    assertThat(inLobby(alice)).isFalse();
    harness.ticks(1);
    assertThat(inLobby(alice)).isTrue();
  }

  @Test
  void goingLiveTakesEveryoneToTheMapAndTheBarAway() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");

    harness.goLive(alice);

    assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
    assertThat(inLobby(alice)).isFalse();
    var border = harness.snapshot().mapId().orElseThrow();
    assertThat(border).isEqualTo("training-yard");
    assertThat(alice.getLocation().getX()).isBetween(0.0, 64.0);
    assertThat(alice.activeBossBars()).isEmpty();
    for (var bot : harness.bots.spawned()) {
      assertThat(inLobby(bot)).isFalse();
    }
  }

  @Test
  void leavingTheLobbyTakesTheBarAway() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);
    harness.until(() -> !barNames(alice).isEmpty());

    alice.performCommand("rwf leave");
    harness.tick(Duration.ofMillis(50));

    assertThat(alice.activeBossBars()).isEmpty();
    assertThat(requireNonNull(alice.getLocation().getWorld())).isEqualTo(harness.overworld);
  }
}
