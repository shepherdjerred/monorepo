package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Teleporter;
import java.nio.file.Path;
import java.time.Duration;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerItemHeldEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Batch B kits on MockBukkit, through the real listeners: Medic, Frost, Warper, Teleporter and
 * Demolitions.
 */
final class RwfKitsBatchBTest {

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

  @Test
  void aMedicInASmallGameIsToldItsHealsAreOff() {
    var fight = on("medic");

    fight.harness.tick(Duration.ofSeconds(1));

    assertThat(RwfHarness.messages(fight.alice))
        .anyMatch(m -> m.contains("As this is a small game, your heals are disabled!"));
    assertThat(KitFight.at(fight.alice, 2)).isEqualTo(Material.BLAZE_ROD);
  }

  @Test
  void aFrostHitFreezesTheEnemysHands() {
    var fight = on("frost");
    fight.alice.getInventory().setHeldItemSlot(1);

    fight.aliceHits();

    var held = new PlayerItemHeldEvent(fight.enemy, 1, 2);
    call(held);
    assertThat(held.isCancelled()).isTrue();
    fight.harness.tick(Duration.ofSeconds(11));
    var later = new PlayerItemHeldEvent(fight.enemy, 1, 2);
    call(later);
    assertThat(later.isCancelled()).as("thawed after ten seconds").isFalse();
  }

  @Test
  void aWarperSendsTheEnemyWhereItStoodTenSecondsAgo() {
    var fight = on("warper");
    var origin = new Location(fight.harness.rwf, 31.5, 65, 20.5);
    fight.alice.teleport(origin);
    for (var second = 0; second < 12; second++) {
      fight.harness.tick(Duration.ofSeconds(1));
    }
    fight.alice.teleport(new Location(fight.harness.rwf, 31.5, 65, 30.5));
    fight.enemy.teleport(new Location(fight.harness.rwf, 31.5, 65, 32.5));
    fight.harness.ticks(2);
    fight.alice.getInventory().setHeldItemSlot(2);

    call(new PlayerInteractEntityEvent(fight.alice, fight.enemy, EquipmentSlot.HAND));

    assertThat(fight.enemy.getLocation().getZ()).isEqualTo(20.5);
  }

  @Test
  void aTeleporterLinksTwoBlocksAndAnAllySneaksAcross() {
    var fight = on("teleporter");
    var world = fight.harness.rwf;
    var first = world.getBlockAt(30, 64, 20);
    var second = world.getBlockAt(36, 64, 20);
    for (var block : java.util.List.of(first, second)) {
      block.setType(Material.STONE);
      block.getRelative(BlockFace.UP).setType(Material.AIR);
      block.getRelative(BlockFace.UP, 2).setType(Material.AIR);
    }
    fight.alice.getInventory().setHeldItemSlot(2);

    for (var block : java.util.List.of(first, second)) {
      // MockBukkit hands out a block's own location: never move it, clone it.
      fight.alice.teleport(block.getLocation().clone().add(0.5, 1, 2.5));
      fight.alice.teleport(
          fight
              .alice
              .getLocation()
              .setDirection(
                  block
                      .getLocation()
                      .clone()
                      .add(0.5, 1, 0.5)
                      .toVector()
                      .subtract(fight.alice.getEyeLocation().toVector())));
      call(
          new PlayerInteractEvent(
              fight.alice,
              Action.RIGHT_CLICK_BLOCK,
              fight.alice.getInventory().getItemInMainHand(),
              block,
              BlockFace.UP,
              EquipmentSlot.HAND));
      // Red Warfare spaced a fighter's right-clicks on blocks at least 0.2 seconds apart.
      fight.harness.tick(Duration.ofMillis(250));
    }

    assertThat(first.getType()).isEqualTo(Material.matchMaterial(Teleporter.BLOCK));
    assertThat(second.getType()).isEqualTo(Material.matchMaterial(Teleporter.BLOCK));
    fight.alice.teleport(first.getLocation().clone().add(0.5, 1, 0.5));
    fight.alice.setSneaking(true);
    fight.harness.ticks(2);
    assertThat(fight.alice.getLocation().getBlockX()).isEqualTo(36);
  }

  @Test
  void aDemolitionsLandmineArmsAndBlowsUpAnEnemy() {
    var fight = on("demolitions");
    var world = fight.harness.rwf;
    var floor = world.getBlockAt(31, 64, 25);
    floor.setType(Material.STONE);
    var plate = floor.getRelative(BlockFace.UP);
    plate.setType(Material.AIR);
    fight.alice.getInventory().setHeldItemSlot(2);
    var replaced = plate.getState();
    // As the server does, the plate stands while the event is raised.
    plate.setType(Material.STONE_PRESSURE_PLATE);
    var place =
        new BlockPlaceEvent(
            plate,
            replaced,
            floor,
            fight.alice.getInventory().getItemInMainHand(),
            fight.alice,
            true,
            EquipmentSlot.HAND);

    call(place);

    assertThat(place.isCancelled()).isTrue();
    assertThat(plate.getType()).isEqualTo(Material.STONE_PRESSURE_PLATE);
    fight.harness.tick(Duration.ofMillis(2050));
    // An armed mine ignores feet for its first tenth of a second.
    fight.harness.tick(Duration.ofMillis(150));
    fight.enemy.teleport(plate.getLocation().clone().add(0.5, 0, 0.5));
    call(
        new PlayerInteractEvent(
            fight.enemy, Action.PHYSICAL, null, plate, BlockFace.SELF, EquipmentSlot.HAND));
    fight.harness.tick(Duration.ofMillis(800));

    assertThat(fight.enemy.getHealth()).isLessThan(20);
    assertThat(plate.getType()).isEqualTo(Material.AIR);
  }
}
