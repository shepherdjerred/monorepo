package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqLocksStore;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockFlag;
import com.shepherdjerred.thestorm.towns.domain.lock.LockType;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import org.bukkit.ExplosionResult;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Openable;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockDispenseEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.CrafterCraftEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerQuitEvent.QuitReason;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.ShapedRecipe;
import org.bukkit.util.Vector;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * Locks on MockBukkit, wired as on the server: locks stored before the plugin starts are loaded and
 * every listener answers for them. Carol owns a chest in the wilderness, the hopper under it, a
 * dispenser with redstone off and one she let redstone drive; Dave owns the hopper beside hers; Bob
 * is a stranger to all of them.
 */
final class LockListenersTest extends AegisServer {

  private static final UUID CAROL = UUID.fromString("00000000-0000-4000-8000-0000000000c0");
  private static final UUID DAVE = UUID.fromString("00000000-0000-4000-8000-0000000000d0");

  /** Carol's chest, in the wilderness. */
  private static final int CHEST_X = 150;

  private PlayerMock carol;

  @Override
  TownsTestPlugin load() {
    var database = StormDatabase.open(directory.resolve("t.db"));
    try {
      database.migrate("towns", LockListenersTest.class.getClassLoader());
      var store = new JooqLocksStore(database);
      for (var lock :
          List.of(
              lock(CAROL, CHEST_X, Y, Z),
              lock(CAROL, CHEST_X, Y - 1, Z),
              lock(DAVE, CHEST_X + 1, Y - 1, Z),
              lock(CAROL, 145, Y, Z),
              lock(CAROL, 157, Y, Z).withOptions(new Lock.Options(false, true)),
              lock(CAROL, CLAIM_X + 10, Y, Z),
              lock(CAROL, 147, Y, Z).withType(LockType.PUBLIC, ""),
              lock(CAROL, 148, Y, Z).withType(LockType.PASSWORD, "gate"),
              lock(CAROL, 152, Y, Z).withFlag(LockFlag.AUTOCLOSE, true),
              lock(CAROL, 153, Y, Z),
              lock(CAROL, 154, Y, Z).withType(LockType.DONATION, ""),
              lock(CAROL, 155, Y, Z).withType(LockType.SUPPLY, ""),
              lock(CAROL, 156, Y, Z).withType(LockType.DISPLAY, ""))) {
        store.save(lock).get(10, TimeUnit.SECONDS);
      }
    } catch (Exception e) {
      throw new IllegalStateException(e);
    } finally {
      database.close();
    }
    return super.load();
  }

  private static Lock lock(UUID owner, int x, int y, int z) {
    return Lock.of(UUID.randomUUID(), owner, Set.of(new BlockPos("world", x, y, z)));
  }

  @BeforeEach
  void placeContainers() {
    carol = new PlayerMock(server, "Carol", CAROL);
    server.addPlayer(carol);
    block(CHEST_X, Y, Z).setType(Material.CHEST);
    block(CHEST_X, Y - 1, Z).setType(Material.HOPPER);
    block(CHEST_X + 1, Y - 1, Z).setType(Material.HOPPER);
    block(CHEST_X - 1, Y - 1, Z).setType(Material.HOPPER);
    block(145, Y, Z).setType(Material.DISPENSER);
    block(157, Y, Z).setType(Material.DISPENSER);
    block(CLAIM_X + 10, Y, Z).setType(Material.CHEST);
    block(147, Y, Z).setType(Material.CHEST);
    block(148, Y, Z).setType(Material.CHEST);
    block(152, Y, Z).setType(Material.IRON_DOOR);
    for (var x = 154; x <= 156; x++) block(x, Y, Z).setType(Material.CHEST);
  }

  @Test
  void offlineActorsRetainOwnershipAndDirectionalLockRestrictions() {
    var port = plugin.services.require(Protection.class);
    carol.disconnect();
    assertThat(server.getPlayer(CAROL)).isNull();
    assertThat(server.getPlayer(DAVE)).isNull();
    for (var x : new int[] {CHEST_X, 154, 155, 156}) {
      var location = block(x, Y, Z).getLocation();
      assertThat(port.check(CAROL, ProtectedAction.INSERT_ITEM, location).isAllowed()).isTrue();
      assertThat(port.check(CAROL, ProtectedAction.REMOVE_ITEM, location).isAllowed()).isTrue();
      assertThat(port.check(DAVE, ProtectedAction.INSERT_ITEM, location).isAllowed())
          .isEqualTo(x == 154);
      assertThat(port.check(DAVE, ProtectedAction.REMOVE_ITEM, location).isAllowed())
          .isEqualTo(x == 155);
    }
  }

  @Test
  void offlineItemMovesRespectBothHalvesOfADirectionalDoubleChest() {
    var port = plugin.services.require(Protection.class);
    block(154, Y, Z)
        .setBlockData(server.createBlockData("minecraft:chest[facing=north,type=left]"));
    block(155, Y, Z)
        .setBlockData(server.createBlockData("minecraft:chest[facing=north,type=right]"));
    for (var x : new int[] {154, 155}) {
      var location = block(x, Y, Z).getLocation();
      assertThat(port.check(DAVE, ProtectedAction.INSERT_ITEM, location).isAllowed()).isFalse();
      assertThat(port.check(DAVE, ProtectedAction.REMOVE_ITEM, location).isAllowed()).isFalse();
    }
  }

  @Test
  void aPublicLockLetsStrangersOpenItAndStillKeepsThemFromBreakingIt() {
    var chest = block(147, Y, Z);

    assertThat(rightClick(bob, chest)).isNotEqualTo(Event.Result.DENY);
    assertThat(breakAllowed(bob, chest)).isFalse();
  }

  @Test
  void aPasswordWorksUntilLogout() {
    var chest = block(148, Y, Z);

    assertThat(rightClick(bob, chest)).isEqualTo(Event.Result.DENY);
    passwordListener().submitPassword(bob, "gate");

    assertThat(rightClick(bob, chest)).isNotEqualTo(Event.Result.DENY);
    call(new PlayerQuitEvent(bob, Component.empty(), QuitReason.DISCONNECTED));
    assertThat(rightClick(bob, chest)).isEqualTo(Event.Result.DENY);
  }

  @Test
  void aLockedDoorStaysShutForStrangersAndAnIronDoorClosesItself() {
    var iron = block(152, Y, Z);

    assertThat(rightClick(bob, iron)).isEqualTo(Event.Result.DENY);
    assertThat(rightClick(carol, iron)).isNotEqualTo(Event.Result.DENY);
    assertThat(((Openable) iron.getBlockData()).isOpen()).isTrue();

    for (var tick = 0; tick < 45; tick++) {
      server.getScheduler().performOneTick();
    }
    assertThat(((Openable) iron.getBlockData()).isOpen()).isFalse();
  }

  @Test
  void aLockedArmorStandRejectsStrangers() {
    var stand =
        (ArmorStand) world.spawnEntity(new Location(world, 153, Y, Z), EntityType.ARMOR_STAND);
    var stranger = new PlayerInteractEntityEvent(bob, stand, EquipmentSlot.HAND);
    var owner = new PlayerInteractEntityEvent(carol, stand, EquipmentSlot.HAND);

    call(stranger);
    call(owner);

    assertThat(stranger.isCancelled()).isTrue();
    assertThat(owner.isCancelled()).isFalse();
  }

  @Test
  void nolockModeToggles() throws InterruptedException {
    assertThat(server.dispatchCommand(carol, "lock mode nolock")).isTrue();
    awaitLine(carol, "nolock is on");
  }

  private Event.Result rightClick(PlayerMock player, Block block) {
    return call(new PlayerInteractEvent(
            player, Action.RIGHT_CLICK_BLOCK, null, block, BlockFace.UP, EquipmentSlot.HAND))
        .useInteractedBlock();
  }

  /** Every container type {@code /lock} protects, as the locked block. */
  enum Lockable {
    CHEST,
    TRAPPED_CHEST,
    BARREL,
    SHULKER_BOX,
    RED_SHULKER_BOX,
    COPPER_CHEST,
    OXIDIZED_COPPER_CHEST,
    FURNACE,
    BLAST_FURNACE,
    SMOKER,
    BREWING_STAND,
    HOPPER,
    DROPPER,
    DISPENSER,
    CRAFTER,
    OAK_SHELF,
  }

  @ParameterizedTest
  @EnumSource(Lockable.class)
  void everyLockableContainerKeepsStrangersOut(Lockable type) {
    var container = block(CHEST_X, Y, Z);
    container.setType(Material.valueOf(type.name()));

    assertThat(rightClick(bob, container)).isEqualTo(Event.Result.DENY);
    assertThat(rightClick(carol, container)).isNotEqualTo(Event.Result.DENY);
    assertThat(breakAllowed(bob, container)).isFalse();
  }

  @Test
  void aLockLeftWhereNoContainerStandsProtectsNothing() {
    var container = block(CHEST_X, Y, Z);
    container.setType(Material.STONE);

    assertThat(breakAllowed(bob, container)).isTrue();
  }

  @Test
  void unlockedContainersAreAnyonesToOpen() {
    var chest = block(140, Y, Z);
    chest.setType(Material.CHEST);

    assertThat(rightClick(bob, chest)).isNotEqualTo(Event.Result.DENY);
  }

  @Test
  void aClaimDoesNotOverrideTheLockOwnersRightToOpen() {
    var chest = block(CLAIM_X + 10, Y, Z);
    var protection = plugin.services.require(Protection.class);

    assertThat(rightClick(carol, chest)).isNotEqualTo(Event.Result.DENY);
    assertThat(rightClick(alice, chest)).isNotEqualTo(Event.Result.DENY);
    assertThat(rightClick(bob, chest)).isEqualTo(Event.Result.DENY);
    assertThat(protection.check(CAROL, ProtectedAction.OPEN_CONTAINER, chest.getLocation()))
        .isInstanceOf(Decision.Allowed.class);
    assertThat(
            protection.check(
                bob.getUniqueId(), ProtectedAction.OPEN_CONTAINER, chest.getLocation()))
        .isInstanceOf(Decision.Denied.class);
  }

  @Test
  void anUnlockedContainerOnAClaimStillNeedsClaimPermission() {
    var chest = block(CLAIM_X + 11, Y, Z);
    chest.setType(Material.CHEST);
    var protection = plugin.services.require(Protection.class);

    assertThat(rightClick(bob, chest)).isEqualTo(Event.Result.DENY);
    assertThat(
            protection.check(
                bob.getUniqueId(), ProtectedAction.OPEN_CONTAINER, chest.getLocation()))
        .isInstanceOf(Decision.Denied.class);
  }

  @Test
  void strangersAreToldTheContainerIsLocked() throws InterruptedException {
    rightClick(bob, block(CHEST_X, Y, Z));

    awaitLine(bob, "That is locked.");
  }

  @Test
  void theOwnerBreakingItReleasesTheLock() {
    var chest = block(CHEST_X, Y, Z);

    assertThat(breakAllowed(bob, chest)).isFalse();
    assertThat(breakAllowed(carol, chest)).isTrue();
    assertThat(breakAllowed(bob, chest)).isTrue();
  }

  @Test
  void itemsMoveOnlyBetweenOneOwnersLocks() {
    var chest = container(CHEST_X, Y, null);
    var carolsHopper = container(CHEST_X, Y - 1, null);
    var davesHopper = container(CHEST_X + 1, Y - 1, null);
    var openHopper = container(CHEST_X - 1, Y - 1, null);
    var cart = container(CHEST_X - 1, Y - 1, cart());
    var openChest = container(140, Y, null);
    block(140, Y, Z).setType(Material.CHEST);

    assertThat(moved(chest, carolsHopper)).isTrue();
    assertThat(moved(chest, openHopper)).isFalse();
    assertThat(moved(openHopper, chest)).isFalse();
    assertThat(moved(chest, davesHopper)).isFalse();
    assertThat(moved(chest, cart)).isFalse();
    assertThat(moved(openChest, openHopper)).isTrue();
  }

  private boolean moved(Inventory from, Inventory to) {
    return !call(new InventoryMoveItemEvent(from, new ItemStack(Material.DIAMOND), to, true))
        .isCancelled();
  }

  @Test
  void explosionsPistonsAndFireSpareLockedContainers() {
    var chest = block(CHEST_X, Y, Z);
    var stone = block(CHEST_X, Y + 1, Z);
    var blast =
        call(
            new BlockExplodeEvent(
                block(CHEST_X - 3, Y, Z),
                block(CHEST_X - 3, Y, Z).getState(),
                new ArrayList<>(List.of(chest, stone)),
                1f,
                ExplosionResult.DESTROY));

    assertThat(blast.blockList()).containsExactly(stone);
    assertThat(
            call(new BlockPistonExtendEvent(
                    block(CHEST_X - 2, Y, Z), List.of(chest), BlockFace.EAST))
                .isCancelled())
        .isTrue();
    assertThat(call(new BlockBurnEvent(chest, null)).isCancelled()).isTrue();
    assertThat(call(new BlockBurnEvent(stone, null)).isCancelled()).isFalse();
  }

  @Test
  void strangersCannotPlaceAHopperOrContainerAgainstALock() {
    var beside = block(CHEST_X, Y + 1, Z);
    beside.setType(Material.HOPPER);

    assertThat(placed(bob, beside, Material.HOPPER)).isFalse();
    assertThat(placed(carol, beside, Material.HOPPER)).isTrue();
  }

  @Test
  void aNewContainerLocksForItsPlacer() {
    var barrel = block(CHEST_X + 8, Y, Z);
    barrel.setType(Material.BARREL);

    assertThat(placed(carol, barrel, Material.BARREL)).isTrue();
    assertThat(rightClick(bob, barrel)).isEqualTo(Event.Result.DENY);
    assertThat(rightClick(carol, barrel)).isNotEqualTo(Event.Result.DENY);
  }

  @Test
  void strangersCannotWireRedstoneToALockedDispenser() {
    var lever = block(146, Y + 1, Z);
    lever.setType(Material.LEVER);

    assertThat(placed(bob, lever, Material.LEVER)).isFalse();
    assertThat(placed(carol, lever, Material.LEVER)).isTrue();
    var far = block(145 + 3, Y, Z);
    far.setType(Material.LEVER);
    assertThat(placed(bob, far, Material.LEVER)).isTrue();
  }

  @Test
  void strangersCannotWireBesideAMachineRedstoneMayDrive() {
    var lever = block(157, Y + 1, Z);
    lever.setType(Material.LEVER);

    assertThat(placed(bob, lever, Material.LEVER)).isFalse();
    assertThat(placed(carol, lever, Material.LEVER)).isTrue();
  }

  @Test
  void aMachineWhoseOwnerAllowsRedstoneDispenses() {
    var machine = block(157, Y, Z);

    assertThat(
            call(new BlockDispenseEvent(machine, new ItemStack(Material.DIAMOND), new Vector()))
                .isCancelled())
        .isFalse();
  }

  @Test
  void aMachineOnItsOwnersPrivateClaimRunsFromRedstone() {
    var machine = block(CLAIM_X + 3, Y, Z);
    machine.setType(Material.DISPENSER);

    assertThat(placed(alice, machine, Material.DISPENSER)).isTrue();

    assertThat(
            call(new BlockDispenseEvent(machine, new ItemStack(Material.DIAMOND), new Vector()))
                .isCancelled())
        .isFalse();
  }

  @Test
  void aMachineStopsRunningFromRedstoneOnceItsClaimsSwitchesArePublic()
      throws InterruptedException {
    var machine = block(CLAIM_X + 3, Y, Z);
    machine.setType(Material.DISPENSER);
    assertThat(placed(alice, machine, Material.DISPENSER)).isTrue();

    alice.setLocation(new Location(world, CLAIM_X + 3, Y, Z));
    server.dispatchCommand(alice, "claim flag public-switches true");
    awaitLine(alice, "public-switches is now on here.");

    assertThat(
            call(new BlockDispenseEvent(machine, new ItemStack(Material.DIAMOND), new Vector()))
                .isCancelled())
        .isTrue();
  }

  @Test
  void aPrivateClaimsMachineIgnoresPowerFromOtherLand() {
    var machine = block(CLAIM_X, Y, Z);
    machine.setType(Material.DISPENSER);
    assertThat(placed(alice, machine, Material.DISPENSER)).isTrue();
    block(WILD_X, Y, Z).setType(Material.LEVER);

    assertThat(
            call(new BlockDispenseEvent(machine, new ItemStack(Material.DIAMOND), new Vector()))
                .isCancelled())
        .isTrue();
  }

  @Test
  void aPrivateClaimsMachineRunsFromAControlOnItsOwnersOtherPrivateClaim() {
    var machine = block(CLAIM_X + 15, Y, Z);
    machine.setType(Material.DISPENSER);
    assertThat(placed(alice, machine, Material.DISPENSER)).isTrue();
    block(CLAIM_X + 16, Y, Z).setType(Material.LEVER);

    assertThat(
            call(new BlockDispenseEvent(machine, new ItemStack(Material.DIAMOND), new Vector()))
                .isCancelled())
        .isFalse();
  }

  @Test
  void aPrivateClaimsMachineIgnoresAPublicSwitchOnTheSameTownsOtherClaim()
      throws InterruptedException {
    var machine = block(CLAIM_X + 15, Y, Z);
    machine.setType(Material.DISPENSER);
    assertThat(placed(alice, machine, Material.DISPENSER)).isTrue();
    block(CLAIM_X + 16, Y, Z).setType(Material.LEVER);

    alice.setLocation(new Location(world, CLAIM_X + 20, Y, Z));
    server.dispatchCommand(alice, "claim flag public-switches true");
    awaitLine(alice, "public-switches is now on here.");

    assertThat(
            call(new BlockDispenseEvent(machine, new ItemStack(Material.DIAMOND), new Vector()))
                .isCancelled())
        .isTrue();
  }

  @Test
  void anUnlockedHopperItsOwnerPlacedStillCannotDrainTheirLock() {
    var placers = new Placers(new NamespacedKey(plugin, "placed_by"));
    var claimChest = container(CLAIM_X + 10, Y, null);
    var chest = container(CHEST_X, Y, null);
    block(CLAIM_X + 10, Y - 1, Z).setType(Material.HOPPER);
    block(CHEST_X - 2, Y - 1, Z).setType(Material.HOPPER);
    assertThat(placers.record(block(CLAIM_X + 10, Y - 1, Z), CAROL)).isTrue();
    assertThat(placers.record(block(CHEST_X - 2, Y - 1, Z), CAROL)).isTrue();

    assertThat(moved(claimChest, container(CLAIM_X + 10, Y - 1, null))).isFalse();
    assertThat(moved(chest, container(CHEST_X - 2, Y - 1, null))).isFalse();
  }

  @Test
  void aNewMachineInTheOpenKeepsRedstoneOffSoStrangersCannotWorkItsControls() {
    var open = block(CHEST_X - 6, Y, Z);
    open.setType(Material.DISPENSER);

    assertThat(placed(carol, open, Material.DISPENSER)).isTrue();

    assertThat(
            call(new BlockDispenseEvent(open, new ItemStack(Material.DIAMOND), new Vector()))
                .isCancelled())
        .isTrue();
  }

  @Test
  void lockedMachinesWithRedstoneOffCannotDispenseOrCraftEvenWithExistingWiring() {
    var machine = block(145, Y, Z);
    assertThat(
            call(new BlockDispenseEvent(machine, new ItemStack(Material.DIAMOND), new Vector()))
                .isCancelled())
        .isTrue();

    machine.setType(Material.CRAFTER);
    var recipe =
        new ShapedRecipe(
            new NamespacedKey(plugin, "locked_craft"), new ItemStack(Material.DIAMOND));
    recipe.shape("D");
    recipe.setIngredient('D', Material.DIRT);
    assertThat(
            call(new CrafterCraftEvent(machine, recipe, new ItemStack(Material.DIAMOND)))
                .isCancelled())
        .isTrue();

    var unlocked = block(144, Y, Z);
    unlocked.setType(Material.DISPENSER);
    assertThat(
            call(new BlockDispenseEvent(unlocked, new ItemStack(Material.DIAMOND), new Vector()))
                .isCancelled())
        .isFalse();
  }

  private boolean placed(PlayerMock player, Block block, Material type) {
    var event =
        new BlockPlaceEvent(
            block,
            block.getState(),
            block.getRelative(BlockFace.DOWN),
            new ItemStack(type),
            player,
            true,
            EquipmentSlot.HAND);
    return !call(event).isCancelled();
  }

  @Test
  void theProtectionPortRespectsLocks() {
    var protection = plugin.services.require(Protection.class);
    var at = new Location(world, CHEST_X, Y, Z);

    var denied = protection.check(bob.getUniqueId(), ProtectedAction.OPEN_CONTAINER, at);
    assertThat(denied).isInstanceOf(Decision.Denied.class);
    assertThat(plain(((Decision.Denied) denied).reason())).isEqualTo("[Towns]: That is locked.");
    assertThat(protection.check(bob.getUniqueId(), ProtectedAction.BREAK, at).isAllowed())
        .isFalse();
    assertThat(protection.check(CAROL, ProtectedAction.OPEN_CONTAINER, at).isAllowed()).isTrue();
    assertThat(
            protection
                .check(
                    bob.getUniqueId(),
                    ProtectedAction.OPEN_CONTAINER,
                    new Location(world, 140, Y, Z))
                .isAllowed())
        .isTrue();
  }

  @Test
  void staffWithBypassOpenLocks() {
    bob.addAttachment(plugin, Guard.BYPASS_PERMISSION, true);

    assertThat(rightClick(bob, block(CHEST_X, Y, Z))).isNotEqualTo(Event.Result.DENY);
  }

  @Test
  void locksSurviveARestart() {
    server.getPluginManager().disablePlugin(plugin);
    plugin = super.load();

    assertThat(breakAllowed(bob, block(CHEST_X, Y, Z))).isFalse();
  }

  private LockListener passwordListener() {
    for (var registered : PlayerInteractEvent.getHandlerList().getRegisteredListeners()) {
      if (registered.getListener() instanceof LockListener listener) {
        return listener;
      }
    }
    throw new IllegalStateException("lock listener is not registered");
  }

  /** An inventory at block ({@code x}, {@code y}, {@code Z}), held by {@code holder}. */
  private Inventory container(int x, int y, @Nullable Object holder) {
    var location = new Location(world, x, y, Z);
    return (Inventory)
        Proxy.newProxyInstance(
            Inventory.class.getClassLoader(),
            new Class<?>[] {Inventory.class},
            (proxy, method, arguments) ->
                switch (method.getName()) {
                  case "getLocation" -> location.clone();
                  case "getHolder" -> holder;
                  default -> throw new UnsupportedOperationException(method.getName());
                });
  }

  /** A hopper minecart, as the lock listener sees it: an entity nobody can lock. */
  private Entity cart() {
    var at = new Location(world, CHEST_X - 1, Y - 1, Z);
    return (Entity)
        Proxy.newProxyInstance(
            Entity.class.getClassLoader(),
            new Class<?>[] {Entity.class, InventoryHolder.class},
            (proxy, method, arguments) ->
                switch (method.getName()) {
                  case "getOrigin", "getLocation" -> at.clone();
                  default -> throw new UnsupportedOperationException(method.getName());
                });
  }
}
