package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Proxy;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Raid;
import org.bukkit.block.Block;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Boat;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Wolf;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityInteractEvent;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.raid.RaidTriggerEvent;
import org.bukkit.event.vehicle.VehicleEnterEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Regression tests for the grief holes the first review found, on MockBukkit. Holes MockBukkit
 * cannot simulate are listed in {@code E2E-CASES.md} and covered by pure-domain tests.
 */
final class GriefRegressionTest extends AegisServer {

  private Block typed(int x, Material type) {
    var block = block(x, Y, Z);
    block.setType(type);
    return block;
  }

  // P0-1: arrows, thrown items and mobs pressing buttons and plates.

  @Test
  void anOutsidersArrowCannotPressATownsButton() {
    var button = typed(CLAIM_X + 2, Material.OAK_BUTTON);
    var arrow = world.spawn(new Location(world, CLAIM_X + 2, Y, Z), Arrow.class);

    arrow.setShooter(bob);
    assertThat(call(new EntityInteractEvent(arrow, button)).isCancelled()).isTrue();
    arrow.setShooter(alice);
    assertThat(call(new EntityInteractEvent(arrow, button)).isCancelled()).isFalse();
  }

  @Test
  void anOutsidersPetCannotTrampleATownsFarmland() {
    var farmland = typed(CLAIM_X + 2, Material.FARMLAND);
    var wolf = world.spawn(new Location(world, CLAIM_X + 2, Y + 1, Z), Wolf.class);
    wolf.setOwner(bob);

    assertThat(call(new EntityInteractEvent(wolf, farmland)).isCancelled()).isTrue();
  }

  // P0-2: redstone wired into a claim from the wilderness.

  private boolean placeAllowed(PlayerMock player, int x, Material type) {
    var placed = block(x, Y, Z);
    var against = block(x, Y - 1, Z);
    var replaced = placed.getState();
    placed.setType(type);
    var item = type == Material.REDSTONE_WIRE ? Material.REDSTONE : type;
    var event =
        new BlockPlaceEvent(
            placed, replaced, against, new ItemStack(item), player, true, EquipmentSlot.HAND);
    return !call(event).isCancelled();
  }

  @Test
  void anOutsiderCannotWireRedstoneAgainstAClaim() {
    assertThat(placeAllowed(bob, WILD_X, Material.LEVER)).isFalse();
    assertThat(placeAllowed(bob, WILD_X, Material.REDSTONE_TORCH)).isFalse();
    assertThat(placeAllowed(bob, WILD_X, Material.REDSTONE_BLOCK)).isFalse();
    assertThat(placeAllowed(bob, WILD_X - 1, Material.REDSTONE_WIRE)).isTrue();
    assertThat(placeAllowed(bob, WILD_X, Material.COBBLESTONE)).isTrue();
    assertThat(placeAllowed(alice, WILD_X, Material.LEVER)).isTrue();
  }

  // P1-4: tamed pets act for their owners.

  @Test
  void anOutsidersPetCannotHurtATownsAnimals() {
    var cow = world.spawnEntity(new Location(world, 170, Y, Z), EntityType.COW);
    var wolf = world.spawn(new Location(world, 170, Y, Z), Wolf.class);

    wolf.setOwner(bob);
    assertThat(hitAllowed(wolf, cow)).isFalse();
    wolf.setOwner(alice);
    assertThat(hitAllowed(wolf, cow)).isTrue();
  }

  // P1-5: portals arrive like teleports.

  @Test
  void aPortalCannotDropAnOutsiderIntoATown() {
    var from = new Location(world, 0, Y, 500);
    var into = new Location(world, 170, Y, Z);
    var wild = new Location(world, 150, Y, Z);

    assertThat(
            call(new PlayerPortalEvent(
                    bob, from, into, PlayerTeleportEvent.TeleportCause.NETHER_PORTAL))
                .isCancelled())
        .isTrue();
    assertThat(
            call(new PlayerPortalEvent(
                    bob, from, wild, PlayerTeleportEvent.TeleportCause.NETHER_PORTAL))
                .isCancelled())
        .isFalse();
    assertThat(
            call(new PlayerPortalEvent(
                    alice, from, into, PlayerTeleportEvent.TeleportCause.NETHER_PORTAL))
                .isCancelled())
        .isFalse();
  }

  // P1-6: raids.

  private boolean raidAllowed(PlayerMock player, Location centre) {
    var raid =
        (Raid)
            Proxy.newProxyInstance(
                Raid.class.getClassLoader(),
                new Class<?>[] {Raid.class},
                (proxy, method, arguments) -> {
                  if (method.getName().equals("getLocation")) {
                    return centre.clone();
                  }
                  throw new UnsupportedOperationException(method.getName());
                });
    return !call(new RaidTriggerEvent(raid, world, player)).isCancelled();
  }

  @Test
  void anOutsiderCannotStartARaidOnATown() {
    var town = new Location(world, 170, Y, Z);
    var wild = new Location(world, 120, Y, Z);

    bob.teleport(wild);
    assertThat(raidAllowed(bob, town)).isFalse();
    assertThat(raidAllowed(bob, wild)).isTrue();
    bob.teleport(town);
    assertThat(raidAllowed(bob, wild)).isFalse();
    alice.teleport(town);
    assertThat(raidAllowed(alice, town)).isTrue();
  }

  // P1-7: boats carrying animals off.

  @Test
  void aBoatInTheWildCannotPickUpATownsAnimal() {
    var cow = world.spawnEntity(new Location(world, CLAIM_X, Y, Z), EntityType.COW);
    var wildBoat = world.spawn(new Location(world, WILD_X, Y, Z), Boat.class);
    var townBoat = world.spawn(new Location(world, CLAIM_X + 1, Y, Z), Boat.class);

    assertThat(call(new VehicleEnterEvent(wildBoat, cow)).isCancelled()).isTrue();
    assertThat(call(new VehicleEnterEvent(townBoat, cow)).isCancelled()).isFalse();
  }

  // P1-10: withers.

  @Test
  void anOutsiderCannotBuildAWitherNearATown() {
    // Chunk 15 is within 8 chunks of Aegis but not of spawn; chunk 62 is far from both.
    block(250, Y - 1, Z).setType(Material.SOUL_SAND);
    block(1000, Y - 1, Z).setType(Material.SOUL_SAND);

    assertThat(placeAllowed(bob, 250, Material.WITHER_SKELETON_SKULL)).isFalse();
    assertThat(placeAllowed(alice, 250, Material.WITHER_SKELETON_SKULL)).isTrue();
    assertThat(placeAllowed(bob, 1000, Material.WITHER_SKELETON_SKULL)).isTrue();
  }
}
