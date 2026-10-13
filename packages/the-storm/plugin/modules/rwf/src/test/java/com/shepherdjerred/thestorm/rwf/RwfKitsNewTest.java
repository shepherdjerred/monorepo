package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.nio.file.Path;
import java.time.Duration;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.BlockDisplay;
import org.bukkit.entity.FishHook;
import org.bukkit.entity.TextDisplay;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The new kits on MockBukkit, through the real listeners: Saboteur, Spotter, Grappler, Bannerman,
 * Engineer, Tracker and Decoy.
 */
final class RwfKitsNewTest {

  @TempDir Path directory;
  private @Nullable KitFight fight;

  @AfterEach
  void stop() {
    if (fight != null) {
      fight.close();
    }
  }

  private KitFight on(String kit) {
    fight = KitFight.on(directory, kit);
    return fight;
  }

  private void call(org.bukkit.event.Event event) {
    requireNonNull(fight).harness.server.getPluginManager().callEvent(event);
  }

  private void rightClick(@Nullable Block block) {
    var fight = requireNonNull(this.fight);
    call(
        new PlayerInteractEvent(
            fight.alice,
            block == null ? Action.RIGHT_CLICK_AIR : Action.RIGHT_CLICK_BLOCK,
            fight.alice.getInventory().getItemInMainHand(),
            block,
            BlockFace.UP,
            EquipmentSlot.HAND));
  }

  /** Alice looks along +z, at the enemy two blocks in front of her. */
  private static void faceEnemy(KitFight fight) {
    fight.alice.teleport(new Location(fight.harness.rwf, 31.5, 65, 20.5, 0, 0));
  }

  private long displays() {
    return requireNonNull(fight).harness.rwf.getEntitiesByClass(BlockDisplay.class).size();
  }

  @Test
  void aSaboteursArmingIsHiddenFromTheEnemyButNotItsTeam() {
    var fight = on("saboteur");
    var harness = fight.harness;
    var enemyTeam = harness.snapshot().combatant(fight.enemyId).orElseThrow().team().orElseThrow();
    var bombId = enemyTeam == TeamColor.RED ? "red-1" : "blue-1";
    var site = harness.snapshot().bomb(bombId).orElseThrow().position();
    var block = harness.rwf.getBlockAt(site.x(), site.y(), site.z());
    fight.alice.teleport(block.getLocation().clone().add(1.5, 0, 0.5));
    fight.enemy.teleport(block.getLocation().clone().add(-1.5, 0, 0.5));
    fight.alice.getInventory().setHeldItemSlot(0);
    var fuse = requireNonNull(fight.alice.getInventory().getItem(0));

    for (var i = 0; i < 4; i++) {
      call(
          new PlayerInteractEvent(
              fight.alice, Action.RIGHT_CLICK_BLOCK, fuse, block, BlockFace.UP));
      harness.tick(Duration.ofMillis(500));
    }

    assertThat(harness.snapshot().bomb(bombId).orElseThrow().state())
        .isInstanceOf(MatchSnapshot.BombView.State.Arming.class);
    // The display refresh runs every five server ticks; the four arming clock jumps above
    // need not include a refresh after the first interaction. Wait with the clock held still.
    harness.until(
        () ->
            harness.rwf.getEntitiesByClass(TextDisplay.class).stream()
                    .filter(d -> d.getLocation().distance(block.getLocation()) < 4)
                    .count()
                == 2);
    var holograms =
        harness.rwf.getEntitiesByClass(TextDisplay.class).stream()
            .filter(d -> d.getLocation().distance(block.getLocation()) < 4)
            .toList();
    assertThat(holograms).hasSize(2);
    assertThat(holograms.stream().filter(fight.enemy::canSee)).hasSize(1);
    assertThat(holograms.stream().filter(fight.alice::canSee)).hasSize(1);
    var enemySees = holograms.stream().filter(fight.enemy::canSee).findFirst().orElseThrow();
    assertThat(fight.alice.canSee(enemySees)).isFalse();
  }

  @Test
  void aSpotterMakesTheEnemyInSightGlowForSixSeconds() {
    var fight = on("spotter");
    faceEnemy(fight);
    fight.alice.getInventory().setHeldItemSlot(2);
    var before = displays();

    rightClick(null);

    assertThat(displays()).as("a glow for each enemy in sight").isGreaterThan(before);
    fight.harness.tick(Duration.ofSeconds(7));
    assertThat(displays()).isEqualTo(before);
  }

  @Test
  void aGrapplerIsPulledTowardItsHook() {
    var fight = on("grappler");
    faceEnemy(fight);
    // The rules know where she stands once a tick has seen her there.
    fight.harness.ticks(1);
    fight.alice.getInventory().setHeldItemSlot(2);
    var hook =
        fight.harness.rwf.spawn(new Location(fight.harness.rwf, 31.5, 70, 30.5), FishHook.class);

    call(new PlayerFishEvent(fight.alice, null, hook, PlayerFishEvent.State.REEL_IN));

    var velocity = fight.alice.getVelocity();
    assertThat(velocity.getZ()).isPositive();
    assertThat(velocity.getY()).isPositive();
  }

  @Test
  void aBannermansBannerFallsToThreeEnemyStrikes() {
    var fight = on("bannerman");
    var world = fight.harness.rwf;
    var floor = world.getBlockAt(31, 64, 25);
    floor.setType(Material.STONE);
    var spot = floor.getRelative(BlockFace.UP);
    spot.setType(Material.AIR);
    fight.alice.getInventory().setHeldItemSlot(2);
    var item = fight.alice.getInventory().getItemInMainHand();
    assertThat(item.getType().name()).endsWith("_BANNER");
    var replaced = spot.getState();
    spot.setType(item.getType());

    call(new BlockPlaceEvent(spot, replaced, floor, item, fight.alice, true, EquipmentSlot.HAND));

    assertThat(spot.getType()).isEqualTo(item.getType());
    for (var strike = 0; strike < 3; strike++) {
      call(
          new PlayerInteractEvent(
              fight.enemy, Action.LEFT_CLICK_BLOCK, null, spot, BlockFace.UP, EquipmentSlot.HAND));
    }
    assertThat(spot.getType()).isEqualTo(Material.AIR);
  }

  @Test
  void anEngineersBarricadeStandsForEightSeconds() {
    var fight = on("engineer");
    var world = fight.harness.rwf;
    var floor = world.getBlockAt(31, 64, 40);
    floor.setType(Material.STONE);
    for (var x = 30; x <= 32; x++) {
      for (var y = 65; y <= 66; y++) {
        world.getBlockAt(x, y, 40).setType(Material.AIR);
      }
    }
    faceEnemy(fight);
    fight.alice.getInventory().setHeldItemSlot(2);

    rightClick(floor);

    assertThat(world.getBlockAt(31, 65, 40).getType()).isEqualTo(Material.BRICKS);
    assertThat(world.getBlockAt(30, 66, 40).getType()).isEqualTo(Material.BRICKS);
    fight.harness.tick(Duration.ofSeconds(8));
    fight.harness.ticks(1);
    assertThat(world.getBlockAt(31, 65, 40).getType()).isEqualTo(Material.AIR);
  }

  @Test
  void aTrackersFirstHitPointsItsTeamsCompassesAtTheEnemy() {
    var fight = on("tracker");
    fight.alice.getInventory().setHeldItemSlot(1);

    fight.aliceHits();
    fight.harness.ticks(5);

    assertThat(fight.alice.getCompassTarget().toVector())
        .isEqualTo(fight.enemy.getLocation().toVector());
  }

  @Test
  void aDecoyHidesFromTheEnemyWhileItsCopyRuns() {
    var fight = on("decoy");
    faceEnemy(fight);
    fight.alice.getInventory().setHeldItemSlot(2);

    rightClick(null);

    // MockBukkit's Mannequin cannot take a player's skin (setProfile is unsupported), so the
    // running copy is covered by NewKitsTest; here the owner's vanishing is.
    assertThat(fight.enemy.canSee(fight.alice)).isFalse();
    assertThat(fight.alice.canSee(fight.alice)).isTrue();
    fight.harness.tick(Duration.ofSeconds(2));
    assertThat(fight.enemy.canSee(fight.alice)).isFalse();
    fight.harness.tick(Duration.ofSeconds(1));
    assertThat(fight.enemy.canSee(fight.alice)).isTrue();
  }
}
