package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static java.util.stream.Collectors.toUnmodifiableSet;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.snapshot.EffectRecord;
import com.shepherdjerred.thestorm.core.snapshot.Experience;
import com.shepherdjerred.thestorm.core.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.snapshot.Position;
import com.shepherdjerred.thestorm.core.snapshot.Snapshot;
import com.shepherdjerred.thestorm.core.snapshot.Vitals;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqSnapshotStore;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Entity;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffectType;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Watching on MockBukkit: {@code /rwf spectate} snapshots a player through the members' crash-safe
 * keeper and puts them in spectator mode at the spectator point; leaving, quitting and a crash all
 * restore them exactly; watchers are never combatants and never keep a match alive; {@code /rwf
 * spectate next} cycles the living fighters; members cannot watch; a watcher joins under the
 * snapshot they already hold.
 */
final class RwfWatchTest {

  private static final NamespacedKey ATTACK_SPEED =
      new NamespacedKey("thestorm", "rwf_attack_speed");

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

  private RwfHarness harness() {
    return requireNonNull(running);
  }

  private List<Snapshot> stored() {
    return new JooqSnapshotStore(harness().database).loadAll().join();
  }

  /**
   * {@code /rwf spectate}, until the watcher stands in spectator mode and their snapshot is stored.
   */
  private void watch(PlayerMock player) {
    player.performCommand("rwf spectate");
    harness().until(() -> player.getGameMode() == GameMode.SPECTATOR);
    harness().until(() -> stored().stream().anyMatch(s -> s.player().equals(player.getUniqueId())));
  }

  /** Runs {@code command} as {@code player} until a message containing {@code text} arrives. */
  private List<String> answer(PlayerMock player, String command, String text) {
    RwfHarness.messages(player);
    player.performCommand(command);
    var seen = new ArrayList<String>();
    harness()
        .until(
            () -> {
              seen.addAll(RwfHarness.messages(player));
              return seen.stream().anyMatch(m -> m.contains(text));
            });
    return seen;
  }

  private void assertRestored(PlayerMock player) {
    assertThat(player.getInventory().contains(Material.DIAMOND, 5)).isTrue();
    assertThat(player.getInventory().getHelmet()).isEqualTo(ItemStack.of(Material.IRON_HELMET));
    assertThat(player.getLevel()).isEqualTo(7);
    assertThat(player.getHealth()).isEqualTo(13);
    assertThat(player.getFoodLevel()).isEqualTo(15);
    assertThat(player.getPotionEffect(PotionEffectType.SPEED)).isNotNull();
    assertThat(player.getWorld()).isEqualTo(harness().overworld);
    assertThat(player.getLocation().getX()).isEqualTo(50.5);
    assertThat(player.getGameMode()).isEqualTo(GameMode.SURVIVAL);
    assertThat(player.getScoreboard())
        .isEqualTo(harness().server.getScoreboardManager().getMainScoreboard());
  }

  private static boolean hasAttackSpeed(PlayerMock player) {
    // A mock player carries attack speed only once the match has registered it.
    var attribute = player.getAttribute(Attribute.ATTACK_SPEED);
    return attribute != null && attribute.getModifier(ATTACK_SPEED) != null;
  }

  private void assertWatching(PlayerMock player) {
    assertThat(player.getGameMode()).isEqualTo(GameMode.SPECTATOR);
    assertThat(player.getWorld()).isEqualTo(harness().rwf);
    assertThat(player.getLocation().getY()).as("the spectator point").isEqualTo(76);
    assertThat(harness().inMatch(player)).isFalse();
  }

  @Test
  void watchingSnapshotsThePlayerAndLeavingRestoresThemExactly() {
    var harness = start();
    var bob = harness.loadedPlayer("Bob");

    watch(bob);

    assertWatching(bob);
    assertThat(bob.getInventory().isEmpty()).isTrue();
    assertThat(bob.getLevel()).isZero();
    assertThat(bob.getActivePotionEffects()).isEmpty();
    assertThat(hasAttackSpeed(bob)).isFalse();
    assertThat(bob.getScoreboard())
        .isNotEqualTo(harness.server.getScoreboardManager().getMainScoreboard());
    assertThat(stored())
        .singleElement()
        .satisfies(
            s -> {
              assertThat(s.player()).isEqualTo(bob.getUniqueId());
              assertThat(s.scope()).isEqualTo("rwf_watch");
            });
    assertThat(harness.snapshot().combatants()).isEmpty();

    bob.performCommand("rwf leave");

    assertRestored(bob);
    // The row stays until a login proves the restored belongings and their marker were saved.
    assertThat(stored()).hasSize(1);
    harness.rejoinAfterSave(bob);
    harness.until(() -> stored().isEmpty());
    watch(bob);
    assertWatching(bob);
  }

  @Test
  void aWatcherWhoQuitsIsRestoredBeforeTheServerSavesThem() {
    var harness = start();
    var bob = harness.loadedPlayer("Bob");
    watch(bob);

    bob.disconnect();

    assertRestored(bob);
    assertThat(stored()).hasSize(1);
    bob.reconnect();
    harness.until(() -> stored().isEmpty());
  }

  @Test
  void aWatcherIsRestoredWhenTheModuleStops() {
    var harness = start();
    var bob = harness.loadedPlayer("Bob");
    watch(bob);

    harness.disable();

    assertRestored(bob);
  }

  @Test
  void aWatchersSnapshotLeftByACrashIsRestoredOnTheirNextLogin() {
    var harness = RwfHarness.prepare(directory);
    running = harness;
    var bob = harness.server.addPlayer("Bob");
    // The crash caught Bob watching: player data saved him empty, in spectator mode, in the world.
    bob.teleport(new Location(harness.rwf, 31.5, 76, 31.5));
    bob.setGameMode(GameMode.SPECTATOR);
    var belongings = new ItemStack[] {ItemStack.of(Material.EMERALD, 12)};
    new JooqSnapshotStore(harness.database)
        .save(
            new Snapshot(
                bob.getUniqueId(),
                "rwf_watch",
                new Position("world", 5.5, 70, 5.5, 0, 0),
                new Vitals(9, 11, 1, 0, "SURVIVAL"),
                new Experience(3, 0.25f, 40),
                ItemData.of(ItemStack.serializeItemsAsBytes(belongings)),
                List.of(new EffectRecord("minecraft:haste", 0, 400, false, true, true)),
                Samples.T0))
        .join();

    harness.enable(directory);
    harness.until(() -> bob.getInventory().contains(Material.EMERALD, 12));

    assertThat(bob.getGameMode()).isEqualTo(GameMode.SURVIVAL);
    assertThat(bob.getWorld()).isEqualTo(harness.overworld);
    assertThat(bob.getLocation().getX()).isEqualTo(5.5);
    assertThat(answer(bob, "rwf spectate", "Reconnect")).isNotEmpty();
    assertThat(bob.getGameMode()).isEqualTo(GameMode.SURVIVAL);
    harness.rejoinAfterSave(bob);
    harness.until(() -> stored().isEmpty());
  }

  @Test
  void watchersAreNotCombatantsAndDoNotKeepAMatchAlive() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    var bob = harness.loadedPlayer("Bob");
    harness.goLive(alice);
    var matchId = harness.snapshot().matchId();

    watch(bob);

    assertWatching(bob);
    assertThat(harness.snapshot().combatants()).hasSize(8);
    assertThat(hasAttackSpeed(bob)).isFalse();
    alice.performCommand("rwf leave");
    bob.teleport(new Location(harness.rwf, 10.5, 70, 10.5));
    harness.ticks(1);
    harness.tick(Duration.ofSeconds(29));
    assertThat(harness.snapshot().phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
    harness.tick(Duration.ofSeconds(2));
    harness.until(() -> harness.snapshot().phase() == MatchSnapshot.PhaseKind.LOBBY);

    // The match stopped for want of humans although Bob watched; he stays, at the new map's point.
    assertThat(harness.snapshot().matchId()).isNotEqualTo(matchId);
    assertWatching(bob);
    assertThat(bob.getInventory().isEmpty()).isTrue();
    assertThat(harness.wallets.receipts()).isEmpty();
    bob.performCommand("rwf leave");
    assertRestored(bob);
  }

  @Test
  void spectateNextCyclesTheLivingFighters() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    var bob = harness.loadedPlayer("Bob");
    harness.goLive(alice);
    watch(bob);
    var fighters =
        harness.snapshot().combatants().stream()
            .map(c -> c.id().uuid())
            .collect(toUnmodifiableSet());

    assertThat(followed(bob, 8)).isEqualTo(fighters);

    var fallen = harness.bots.spawned().getFirst();
    fallen.setHealth(0);
    harness.until(
        () ->
            !harness
                .snapshot()
                .combatant(harness.bots.idOf(fallen).orElseThrow())
                .orElseThrow()
                .alive());
    var living = followed(bob, 7);
    assertThat(living).hasSize(7).doesNotContain(fallen.getUniqueId());
  }

  /** Who {@code watcher} follows over {@code times} uses of {@code /rwf spectate next}. */
  private static Set<UUID> followed(PlayerMock watcher, int times) {
    var seen = new HashSet<UUID>();
    for (var i = 0; i < times; i++) {
      watcher.performCommand("rwf spectate next");
      Entity target = requireNonNull(watcher.getSpectatorTarget());
      seen.add(target.getUniqueId());
    }
    return seen;
  }

  @Test
  void aMemberCannotWatch() {
    var harness = start();
    var alice = harness.loadedPlayer("Alice");
    harness.enter(alice);

    assertThat(answer(alice, "rwf spectate", "before watching"))
        .anyMatch(m -> m.contains("/rwf leave"));

    assertThat(harness.inMatch(alice)).isTrue();
    assertThat(alice.getGameMode()).isEqualTo(GameMode.SURVIVAL);
    assertThat(answer(alice, "rwf spectate next", "not watching")).isNotEmpty();
  }

  @Test
  void aWatcherJoinsUnderTheSnapshotTheyWatchedWith() {
    var harness = start();
    var bob = harness.loadedPlayer("Bob");
    bob.getInventory().setItem(EquipmentSlot.HEAD, ItemStack.of(Material.IRON_HELMET));
    watch(bob);

    harness.enter(bob);

    assertThat(bob.getGameMode()).isEqualTo(GameMode.SURVIVAL);
    assertThat(bob.getLocation().getY()).as("the lobby").isEqualTo(65);
    assertThat(bob.getLocation().getX()).as("the lobby").isEqualTo(143.5);
    assertThat(hasAttackSpeed(bob)).isTrue();
    assertThat(stored())
        .singleElement()
        .satisfies(s -> assertThat(s.scope()).isEqualTo("rwf_watch"));

    bob.performCommand("rwf leave");

    // The belongings from before he started watching, not the empty spectator he was.
    assertRestored(bob);
    assertThat(hasAttackSpeed(bob)).isFalse();
  }
}
