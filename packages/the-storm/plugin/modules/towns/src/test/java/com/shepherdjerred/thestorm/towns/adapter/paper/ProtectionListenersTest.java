package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.ExplosionResult;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.EntityType;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The most critical listeners on MockBukkit with the shipped {@code towns.yml} and a real SQLite
 * store. Alice founds Aegis and claims chunks (10, 10) and (11, 10), blocks x 160..191, z 160..175;
 * chunk (9, 10), blocks x 144..159, is wilderness; spawn covers chunks -4..3.
 */
final class ProtectionListenersTest extends AegisServer {

  @Test
  void onlyTheTownBreaksItsBlocksAndOutsidersAreTold() throws InterruptedException {
    var claimed = block(CLAIM_X, Y, Z);

    assertThat(breakAllowed(bob, claimed)).isFalse();
    assertThat(breakAllowed(alice, claimed)).isTrue();
    assertThat(breakAllowed(bob, block(WILD_X, Y, Z))).isTrue();
    assertThat(breakAllowed(bob, block(0, Y, 0))).isFalse();
    assertThat(awaitLine(bob, "Aegis owns this land"))
        .contains("[Towns]: Aegis owns this land; you can't break things here.");
  }

  @Test
  void placingFollowsTheSameRules() {
    var claimed = block(CLAIM_X, Y, Z);
    var place =
        new BlockPlaceEvent(
            claimed,
            claimed.getState(),
            block(CLAIM_X, Y - 1, Z),
            new ItemStack(Material.STONE),
            bob,
            true,
            EquipmentSlot.HAND);

    assertThat(call(place).isCancelled()).isTrue();
  }

  @Test
  void outsidersCannotOpenATownsChestsButCanUseSpawnDoors() {
    var chest = block(CLAIM_X, Y, Z);
    chest.setType(Material.CHEST);
    var spawnDoor = block(0, Y, 0);
    spawnDoor.setType(Material.OAK_DOOR);
    var spawnChest = block(1, Y, 0);
    spawnChest.setType(Material.CHEST);

    assertThat(rightClick(bob, chest)).isEqualTo(Event.Result.DENY);
    assertThat(rightClick(alice, chest)).isNotEqualTo(Event.Result.DENY);
    assertThat(rightClick(bob, spawnDoor)).isNotEqualTo(Event.Result.DENY);
    assertThat(rightClick(bob, spawnChest)).isEqualTo(Event.Result.DENY);
  }

  private Event.Result rightClick(PlayerMock player, Block block) {
    var event =
        call(
            new PlayerInteractEvent(
                player, Action.RIGHT_CLICK_BLOCK, null, block, BlockFace.UP, EquipmentSlot.HAND));
    return event.useInteractedBlock();
  }

  @Test
  void aPistonCannotPushIntoAClaimFromOutside() {
    var outside = block(WILD_X - 1, Y, Z);
    var inside = block(CLAIM_X + 2, Y, Z);

    var intoClaim =
        call(new BlockPistonExtendEvent(outside, List.of(block(WILD_X, Y, Z)), BlockFace.EAST));
    var withinClaim =
        call(new BlockPistonExtendEvent(inside, List.of(block(CLAIM_X + 3, Y, Z)), BlockFace.EAST));
    var acrossTheTownsOwnChunks =
        call(
            new BlockPistonExtendEvent(
                block(173, Y, Z), List.of(block(175, Y, Z)), BlockFace.EAST));

    assertThat(intoClaim.isCancelled()).isTrue();
    assertThat(withinClaim.isCancelled()).isFalse();
    assertThat(acrossTheTownsOwnChunks.isCancelled()).isFalse();
  }

  @Test
  void fluidsFlowOutOfClaimsButNotIn() {
    var wild = block(WILD_X, Y, Z);
    var claimed = block(CLAIM_X, Y, Z);

    assertThat(call(new BlockFromToEvent(wild, claimed)).isCancelled()).isTrue();
    assertThat(call(new BlockFromToEvent(claimed, wild)).isCancelled()).isFalse();
  }

  @Test
  void hoppersNeverMoveItemsAcrossAClaimBorder() {
    var claimChest = container(CLAIM_X);
    var wildHopper = container(WILD_X);
    var claimHopper = container(CLAIM_X + 1);
    var item = new ItemStack(Material.DIAMOND);

    assertThat(call(new InventoryMoveItemEvent(claimChest, item, wildHopper, true)).isCancelled())
        .isTrue();
    assertThat(call(new InventoryMoveItemEvent(wildHopper, item, claimChest, false)).isCancelled())
        .isTrue();
    assertThat(call(new InventoryMoveItemEvent(claimChest, item, claimHopper, true)).isCancelled())
        .isFalse();
  }

  /**
   * An inventory at column {@code x}. MockBukkit's block inventories all report one fixed location,
   * so this stands in with a proxy that knows only where it is, which is all the listener asks.
   */
  private Inventory container(int x) {
    var location = new Location(world, x, Y, Z);
    return (Inventory)
        Proxy.newProxyInstance(
            Inventory.class.getClassLoader(),
            new Class<?>[] {Inventory.class},
            (proxy, method, arguments) ->
                switch (method.getName()) {
                  case "getLocation" -> location.clone();
                  default -> throw new UnsupportedOperationException(method.getName());
                });
  }

  @Test
  void anExplosionOutsideLeavesTheClaimsBlocksAlone() {
    var center = block(WILD_X - 1, Y, Z);
    var wildBlock = block(WILD_X, Y, Z);
    var blocks =
        new ArrayList<>(List.of(wildBlock, block(CLAIM_X, Y, Z), block(CLAIM_X + 1, Y, Z)));

    var event =
        call(new BlockExplodeEvent(center, center.getState(), blocks, 1f, ExplosionResult.DESTROY));

    assertThat(event.blockList()).containsExactly(wildBlock);
  }

  @Test
  void anExplosionInsideAClaimWithExplosionsOffChangesNothing() {
    var center = block(CLAIM_X + 5, Y, Z);
    var blocks = new ArrayList<>(List.of(block(CLAIM_X + 4, Y, Z), block(CLAIM_X + 6, Y, Z)));

    var event =
        call(new BlockExplodeEvent(center, center.getState(), blocks, 1f, ExplosionResult.DESTROY));

    assertThat(event.blockList()).isEmpty();
  }

  @Test
  void outsidersCannotHurtATownsAnimalsButMayFightMobs() {
    var cow = world.spawnEntity(new Location(world, 170, Y, Z), EntityType.COW);
    var zombie = world.spawnEntity(new Location(world, 170, Y, Z), EntityType.ZOMBIE);
    var wildCow = world.spawnEntity(new Location(world, 150, Y, Z), EntityType.COW);

    assertThat(hitAllowed(bob, cow)).isFalse();
    assertThat(hitAllowed(alice, cow)).isTrue();
    assertThat(hitAllowed(bob, zombie)).isTrue();
    assertThat(hitAllowed(bob, wildCow)).isTrue();
  }

  @Test
  void pvpIsOffInClaimsAndSpawnButOnInTheWild() {
    bob.teleport(new Location(world, 150, Y, Z));
    alice.teleport(new Location(world, 152, Y, Z));
    assertThat(hitAllowed(bob, alice)).isTrue();

    alice.teleport(new Location(world, 165, Y, Z));
    assertThat(hitAllowed(bob, alice)).isFalse();

    alice.teleport(new Location(world, 5, Y, 5));
    bob.teleport(new Location(world, 6, Y, 5));
    assertThat(hitAllowed(bob, alice)).isFalse();
  }

  @Test
  void theProtectionPortAnswersOtherModules() {
    var protection = plugin.services.require(Protection.class);
    var inAegis = new Location(world, 170, Y, Z);
    var atSpawn = new Location(world, 8, Y, 8);

    var denied = protection.check(bob.getUniqueId(), ProtectedAction.TELEPORT_INTO, inAegis);
    assertThat(denied).isInstanceOf(Decision.Denied.class);
    assertThat(plain(((Decision.Denied) denied).reason()))
        .isEqualTo("[Towns]: Aegis owns this land; you can't teleport in here.");
    assertThat(protection.check(alice.getUniqueId(), ProtectedAction.SET_HOME, inAegis).isAllowed())
        .isTrue();
    assertThat(
            protection.check(bob.getUniqueId(), ProtectedAction.TELEPORT_INTO, atSpawn).isAllowed())
        .isTrue();
    assertThat(protection.check(bob.getUniqueId(), ProtectedAction.SET_HOME, atSpawn).isAllowed())
        .isFalse();
    assertThat(
            protection
                .check(bob.getUniqueId(), ProtectedAction.BUILD, new Location(world, 500, Y, 0))
                .isAllowed())
        .isTrue();
  }

  @Test
  void bypassLetsStaffBuildButNotFight() {
    bob.addAttachment(plugin, Guard.BYPASS_PERMISSION, true);

    assertThat(breakAllowed(bob, block(CLAIM_X, Y, Z))).isTrue();
    assertThat(breakAllowed(bob, block(0, Y, 0))).isTrue();
  }

  @Test
  void claimInfoDescribesTheLandUnderfoot() throws InterruptedException {
    alice.teleport(new Location(world, 165, Y, Z));
    server.dispatchCommand(alice, "claim info");
    assertThat(awaitLine(alice, "belongs to"))
        .anyMatch(line -> line.startsWith("[Towns]: This chunk belongs to Aegis. Flags: pvp off"));

    bob.teleport(new Location(world, 0, Y, 0));
    server.dispatchCommand(bob, "claim info");
    awaitLine(bob, "This is Spawn, an admin region; it cannot be claimed.");
  }

  @Test
  void outsidersCannotClaimOrUnclaimAndClaimsFollowTheRules() throws InterruptedException {
    bob.teleport(new Location(world, 165, Y, Z));
    server.dispatchCommand(bob, "unclaim");
    awaitLine(bob, "You are not in a town.");

    server.dispatchCommand(bob, "town create Bastion");
    awaitLine(bob, "Founded Bastion");
    server.dispatchCommand(bob, "claim");
    awaitLine(bob, "This chunk already belongs to Aegis.");
    bob.teleport(new Location(world, 8, Y, 8));
    server.dispatchCommand(bob, "claim");
    awaitLine(bob, "Spawn is protected and cannot be claimed.");
    bob.teleport(new Location(world, 140, Y, Z));
    server.dispatchCommand(bob, "claim");
    awaitLine(bob, "This chunk is within 2 chunks of Aegis.");
  }

  @Test
  void flagsOpenAClaimToOutsiders() throws InterruptedException {
    alice.teleport(new Location(world, 165, Y, Z));
    server.dispatchCommand(alice, "claim flag public-build true");
    awaitLine(alice, "public-build is now on here.");

    assertThat(breakAllowed(bob, block(CLAIM_X, Y, Z))).isTrue();
    assertThat(breakAllowed(bob, block(180, Y, Z))).isFalse();
  }

  @Test
  void claimsSurviveARestart() {
    server.getPluginManager().disablePlugin(plugin);
    MockBukkit.unmock();

    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    load();
    var stranger = server.addPlayer("Stranger");

    assertThat(breakAllowed(stranger, world.getBlockAt(CLAIM_X, Y, Z))).isFalse();
    assertThat(breakAllowed(stranger, world.getBlockAt(185, Y, Z))).isFalse();
    assertThat(breakAllowed(stranger, world.getBlockAt(WILD_X, Y, Z))).isTrue();
  }

  @Test
  void deletingTheTownReleasesItsLand() throws InterruptedException {
    server.dispatchCommand(alice, "town delete Aegis");
    awaitLine(alice, "Deleted Aegis and released its 2 chunk(s).");

    assertThat(breakAllowed(bob, block(CLAIM_X, Y, Z))).isTrue();
  }
}
