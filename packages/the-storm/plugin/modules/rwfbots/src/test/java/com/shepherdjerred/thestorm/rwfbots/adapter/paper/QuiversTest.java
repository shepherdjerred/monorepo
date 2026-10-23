package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Quiver;
import java.util.List;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.AbstractArrow;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.CrossbowMeta;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** A body's arrows are counted from its inventory, and landed arrows near a low body are found. */
final class QuiversTest {
  private ServerMock server;
  private WorldMock world;
  private PlayerMock archer;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    world = new WorldMock(new WorldCreator("rwf"));
    server.addWorld(world);
    archer = server.addPlayer();
    archer.teleport(new Location(world, 5.5, 1, 5.5));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void aCrossbowOrAPlainBowCountsItsArrowsAndAnInfinityBowNeverRunsDry() {
    var inventory = archer.getInventory();
    assertThat(Quivers.of(archer)).isEqualTo(Quiver.ENDLESS);

    inventory.setItem(1, new ItemStack(Material.CROSSBOW));
    inventory.setItem(2, new ItemStack(Material.ARROW, 30));
    inventory.setItem(3, new ItemStack(Material.TIPPED_ARROW, 2));
    assertThat(Quivers.of(archer)).isEqualTo(Quiver.of(32));

    var loaded = new ItemStack(Material.CROSSBOW);
    loaded.editMeta(
        CrossbowMeta.class, meta -> meta.addChargedProjectile(new ItemStack(Material.ARROW)));
    inventory.setItem(1, loaded);
    inventory.setItem(2, null);
    inventory.setItem(3, null);
    assertThat(Quivers.of(archer)).isEqualTo(Quiver.of(1));

    inventory.setItem(1, new ItemStack(Material.BOW));
    inventory.setItem(2, new ItemStack(Material.ARROW, 24));
    assertThat(Quivers.of(archer)).isEqualTo(Quiver.of(24));

    var infinite = new ItemStack(Material.BOW);
    infinite.addUnsafeEnchantment(Enchantment.INFINITY, 1);
    inventory.setItem(1, infinite);
    inventory.setItem(2, new ItemStack(Material.ARROW));
    assertThat(Quivers.of(archer)).isEqualTo(Quiver.ENDLESS);
  }

  @Test
  void onlyLandedArrowsAnyoneMayPickUpNearALowBodyAreLoose() {
    var landed = new Location(world, 8.3, 1.05, 5.4);
    LandedArrowMock.add(server, landed, AbstractArrow.PickupStatus.ALLOWED, true);
    LandedArrowMock.add(
        server, new Location(world, 7, 1, 7), AbstractArrow.PickupStatus.ALLOWED, false);
    LandedArrowMock.add(
        server, new Location(world, 6, 1, 4), AbstractArrow.PickupStatus.DISALLOWED, true);
    LandedArrowMock.add(
        server, new Location(world, 4, 1, 4), AbstractArrow.PickupStatus.CREATIVE_ONLY, true);
    LandedArrowMock.add(
        server,
        new Location(world, 5.5 + Quivers.RADIUS + 1, 1, 5.5),
        AbstractArrow.PickupStatus.ALLOWED,
        true);

    assertThat(Quivers.loose(List.of(archer))).containsExactly(new Vec3(8.3, 1.05, 5.4));
    assertThat(Quivers.loose(List.of())).isEmpty();
  }

  @Test
  void looseArrowsAreCappedNearestFirst() {
    for (var i = 0; i < Quivers.MAX_LOOSE + 4; i++) {
      LandedArrowMock.add(
          server,
          new Location(world, 5.5 + (i % 8), 1, 5.5 + i / 8.0),
          AbstractArrow.PickupStatus.ALLOWED,
          true);
    }
    var loose = Quivers.loose(List.of(archer));
    assertThat(loose).hasSize(Quivers.MAX_LOOSE);
    var self = new Vec3(5.5, 1, 5.5);
    assertThat(loose.getFirst().distance(self)).isLessThanOrEqualTo(loose.getLast().distance(self));
  }
}
