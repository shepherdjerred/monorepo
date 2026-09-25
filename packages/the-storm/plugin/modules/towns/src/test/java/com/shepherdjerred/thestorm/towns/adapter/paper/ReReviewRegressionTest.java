package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import io.papermc.paper.event.entity.EntityCollideWithEntityEvent;
import io.papermc.paper.event.player.PrePlayerAttackEntityEvent;
import java.util.List;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Wolf;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.entity.PlayerLeashEntityEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.junit.jupiter.api.Test;

/** Regression tests for the holes the re-review of the grief fixes found. */
final class ReReviewRegressionTest extends AegisServer {

  // 1: redstone one block further.

  @Test
  void aPistonCannotPushAPowerSourceAgainstATown() {
    var piston = block(WILD_X - 3, Y, Z);
    var redstoneBlock = block(WILD_X - 2, Y, Z);
    redstoneBlock.setType(Material.REDSTONE_BLOCK);
    var stone = block(WILD_X - 1, Y, Z);
    stone.setType(Material.STONE);

    // The redstone block would land at WILD_X - 1, not touching Aegis: fine.
    assertThat(
            call(new BlockPistonExtendEvent(piston, List.of(redstoneBlock), BlockFace.EAST))
                .isCancelled())
        .isFalse();
    // Pushed one further it would touch Aegis and power it.
    var closer = block(WILD_X - 1, Y, Z);
    closer.setType(Material.REDSTONE_BLOCK);
    assertThat(
            call(new BlockPistonExtendEvent(
                    block(WILD_X - 2, Y, Z), List.of(closer), BlockFace.EAST))
                .isCancelled())
        .isTrue();
  }

  // 4: borrowed culprits and other people's pets.

  @Test
  void nobodyLeadsAnotherPlayersPetAnywhere() {
    var wolf = world.spawn(new Location(world, 500, Y, 500), Wolf.class);
    wolf.setOwner(alice);

    assertThat(call(new PlayerLeashEntityEvent(wolf, bob, bob, EquipmentSlot.HAND)).isCancelled())
        .isTrue();
    assertThat(
            call(new PlayerLeashEntityEvent(wolf, alice, alice, EquipmentSlot.HAND)).isCancelled())
        .isFalse();
  }

  @Test
  void aRiddenMountShovesATownsAnimalForItsRider() {
    var pig = world.spawnEntity(new Location(world, WILD_X, Y, Z), EntityType.PIG);
    var townCow = world.spawnEntity(new Location(world, CLAIM_X, Y, Z), EntityType.COW);
    pig.addPassenger(bob);

    assertThat(call(new EntityCollideWithEntityEvent(pig, townCow)).isCancelled())
        .as("a ridden pig shoves the town's cow for its rider")
        .isTrue();
  }

  // 8: logging in on land the player may not arrive on.

  @Test
  void anOutsiderLoggingInInsideATownIsMovedOut() {
    bob.teleport(new Location(world, 170, Y, Z));
    bob.disconnect();

    bob.reconnect();

    assertThat(bob.getLocation().getBlockX() >> 4).isNotIn(10, 11);
    alice.teleport(new Location(world, 170, Y, Z));
    alice.disconnect();
    alice.reconnect();
    assertThat(alice.getLocation().getBlockX()).isEqualTo(170);
  }

  // 9: swings that would do nothing are stopped before they land.

  @Test
  void aSwingAtATownsAnimalIsStoppedBeforeItLands() {
    var cow = world.spawnEntity(new Location(world, 170, Y, Z), EntityType.COW);
    var zombie = world.spawnEntity(new Location(world, 170, Y, Z), EntityType.ZOMBIE);

    assertThat(call(new PrePlayerAttackEntityEvent(bob, cow, true)).isCancelled()).isTrue();
    assertThat(call(new PrePlayerAttackEntityEvent(alice, cow, true)).isCancelled()).isFalse();
    assertThat(call(new PrePlayerAttackEntityEvent(bob, zombie, true)).isCancelled()).isFalse();
  }
}
