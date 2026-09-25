package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import io.papermc.paper.event.entity.EntityCollideWithEntityEvent;
import java.util.List;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.EntityType;
import org.bukkit.event.entity.EntityTransformEvent;
import org.junit.jupiter.api.Test;

/** The second review's lesser holes: shoving, lightning, blocks holding up a town's torches. */
final class ContactRegressionTest extends AegisServer {

  @Test
  void anOutsiderCannotShoveATownsAnimalAround() {
    var townCow = world.spawnEntity(new Location(world, 170, Y, Z), EntityType.COW);
    var wildCow = world.spawnEntity(new Location(world, 150, Y, Z), EntityType.COW);

    assertThat(call(new EntityCollideWithEntityEvent(bob, townCow)).isCancelled()).isTrue();
    assertThat(call(new EntityCollideWithEntityEvent(townCow, bob)).isCancelled()).isTrue();
    assertThat(call(new EntityCollideWithEntityEvent(alice, townCow)).isCancelled()).isFalse();
    assertThat(call(new EntityCollideWithEntityEvent(bob, wildCow)).isCancelled()).isFalse();
  }

  @Test
  void lightningDoesNotTurnATownsVillagers() {
    var townVillager = world.spawnEntity(new Location(world, 170, Y, Z), EntityType.VILLAGER);
    var wildVillager = world.spawnEntity(new Location(world, 150, Y, Z), EntityType.VILLAGER);
    var witch = world.spawnEntity(new Location(world, 150, Y, Z), EntityType.WITCH);

    assertThat(
            call(new EntityTransformEvent(
                    townVillager, List.of(witch), EntityTransformEvent.TransformReason.LIGHTNING))
                .isCancelled())
        .isTrue();
    assertThat(
            call(new EntityTransformEvent(
                    wildVillager, List.of(witch), EntityTransformEvent.TransformReason.LIGHTNING))
                .isCancelled())
        .isFalse();
  }

  @Test
  void anOutsiderCannotBreakTheWildBlockATownsTorchHangsOn() {
    block(CLAIM_X, Y, Z).setType(Material.WALL_TORCH);
    var support = block(WILD_X, Y, Z);
    support.setType(Material.STONE);

    assertThat(breakAllowed(bob, support)).isFalse();
    assertThat(breakAllowed(alice, support)).isTrue();

    block(CLAIM_X, Y, Z).setType(Material.STONE);
    assertThat(breakAllowed(bob, support)).isTrue();
  }
}
