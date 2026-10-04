package com.shepherdjerred.thestorm.qol.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.GameRules;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.AreaEffectCloud;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.entity.Wolf;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.DoubleChestInventory;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.LivingEntityMock;
import org.mockbukkit.mockbukkit.simulate.entity.LivingEntitySimulation;

final class CombatAndSortPaperTest {

  @TempDir Path directory;
  QolHarness harness;

  @BeforeEach
  void start() {
    harness = QolHarness.start(directory);
  }

  @AfterEach
  void stop() {
    harness.close();
  }

  @Test
  void taggedPlayersCannotTeleportUntilTheTagEnds() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bob = harness.playerAt("Bob", 2, 0);
    var home = alice.getLocation();

    harness.combat.hit(alice.getUniqueId(), bob.getUniqueId());

    var refusal = harness.guards.refusal(alice.getUniqueId(), home);
    assertThat(refusal)
        .map(PlainTextComponentSerializer.plainText()::serialize)
        .contains("[Combat]: You cannot teleport while in combat (15s left).");
    harness.clock.advance(Duration.ofSeconds(15));
    assertThat(harness.guards.refusal(alice.getUniqueId(), home)).isEmpty();
  }

  @Test
  void loggingOutInCombatKillsThePlayerAndTheirItemsGoToAGrave() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bob = harness.playerAt("Bob", 2, 0);
    alice.getInventory().setItem(0, new ItemStack(Material.GOLDEN_APPLE, 3));
    harness.combat.hit(bob.getUniqueId(), alice.getUniqueId());

    alice.disconnect();

    assertThat(alice.isDead()).isTrue();
    assertThat(harness.awaitMessage(bob, "Alice logged out in combat and was struck down."))
        .isNotEmpty();
    harness.until(() -> harness.graves.ownedBy(alice.getUniqueId()).size() == 1);
    assertThat(harness.combat.inCombat(alice.getUniqueId())).isFalse();
  }

  @Test
  void hitsInASealedWorldTagNobodyAndLoggingOutThereNeverKills() {
    harness.sealed.seal("arena");
    var arena = harness.server.addSimpleWorld("arena");
    arena.loadChunk(0, 0);
    var alice = harness.server.addPlayer("Alice");
    var bob = harness.server.addPlayer("Bob");
    alice.teleport(new Location(arena, 0.5, 5, 0.5));
    bob.teleport(new Location(arena, 2.5, 5, 0.5));

    new LivingEntitySimulation((LivingEntityMock) alice).simulateDamage(1.0, bob);

    assertThat(harness.combat.inCombat(alice.getUniqueId())).isFalse();
    assertThat(harness.combat.inCombat(bob.getUniqueId())).isFalse();

    // A tag earned outside, carried into the match: leaving from inside it is not a combat log.
    harness.combat.hit(bob.getUniqueId(), alice.getUniqueId());
    alice.disconnect();

    assertThat(alice.isDead()).isFalse();
    assertThat(harness.combat.inCombat(alice.getUniqueId())).isFalse();
    assertThat(harness.graves.all()).isEmpty();
  }

  @Test
  void loggingOutOutOfCombatIsHarmless() {
    var alice = harness.playerAt("Alice", 0, 0);

    alice.disconnect();

    assertThat(alice.isDead()).isFalse();
  }

  @Test
  void kicksAndServerErrorsDuringCombatNeverKill() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bob = harness.playerAt("Bob", 2, 0);
    for (var reason :
        List.of(PlayerQuitEvent.QuitReason.KICKED, PlayerQuitEvent.QuitReason.ERRONEOUS_STATE)) {
      harness.combat.hit(bob.getUniqueId(), alice.getUniqueId());

      harness
          .server
          .getPluginManager()
          .callEvent(new PlayerQuitEvent(alice, Component.text("bye"), reason));

      assertThat(alice.isDead()).isFalse();
      assertThat(harness.combat.inCombat(alice.getUniqueId())).isFalse();
    }
  }

  @Test
  void timingOutInCombatKills() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bob = harness.playerAt("Bob", 2, 0);
    harness.combat.hit(bob.getUniqueId(), alice.getUniqueId());

    harness
        .server
        .getPluginManager()
        .callEvent(
            new PlayerQuitEvent(
                alice, Component.text("bye"), PlayerQuitEvent.QuitReason.TIMED_OUT));

    assertThat(alice.isDead()).isTrue();
  }

  @Test
  void petsTntAndLingeringCloudsTagTheirPlayer() {
    var alice = harness.playerAt("Alice", 0, 0);
    var wolf = harness.world.spawn(alice.getLocation(), Wolf.class);
    wolf.setOwner(alice);
    var tnt = harness.world.spawn(alice.getLocation(), TNTPrimed.class);
    tnt.setSource(alice);
    var cloud = harness.world.spawn(alice.getLocation(), AreaEffectCloud.class);
    cloud.setSource(alice);
    var stray = harness.world.spawn(alice.getLocation(), Wolf.class);

    assertThat(CombatListener.attacker(alice)).contains(alice);
    assertThat(CombatListener.attacker(wolf)).contains(alice);
    assertThat(CombatListener.attacker(tnt)).contains(alice);
    assertThat(CombatListener.attacker(cloud)).contains(alice);
    assertThat(CombatListener.attacker(stray)).isEmpty();
  }

  static ItemStack named(Material type, int amount, String name) {
    var stack = new ItemStack(type, amount);
    var meta = stack.getItemMeta();
    meta.customName(Component.text(name));
    stack.setItemMeta(meta);
    return stack;
  }

  @Test
  void sortingOrdersByTypeThenNameAndMergesPartialStacks() {
    Inventory chest = harness.server.createInventory(null, 27);
    chest.setItem(0, new ItemStack(Material.STONE, 5));
    chest.setItem(3, new ItemStack(Material.DIRT, 10));
    chest.setItem(4, named(Material.DIAMOND_SWORD, 1, "Excalibur"));
    chest.setItem(7, new ItemStack(Material.DIRT, 60));
    chest.setItem(9, new ItemStack(Material.APPLE, 1));
    chest.setItem(26, new ItemStack(Material.DIAMOND_SWORD, 1));

    InventorySorter.sort(chest);

    assertThat(Arrays.asList(chest.getContents()).subList(0, 7))
        .containsExactly(
            new ItemStack(Material.APPLE, 1),
            new ItemStack(Material.DIAMOND_SWORD, 1),
            named(Material.DIAMOND_SWORD, 1, "Excalibur"),
            new ItemStack(Material.DIRT, 64),
            new ItemStack(Material.DIRT, 6),
            new ItemStack(Material.STONE, 5),
            null);
  }

  @Test
  void sortingAnEmptyInventoryDoesNothing() {
    Inventory chest = harness.server.createInventory(null, 9);
    InventorySorter.sort(chest);
    assertThat(chest.isEmpty()).isTrue();
  }

  @Test
  void aSneakingPunchSortsYourEnderChest() {
    var alice = harness.playerAt("Alice", 0, 0);
    var enderChest = harness.world.getBlockAt(1, 5, 0);
    enderChest.setType(Material.ENDER_CHEST);
    alice.getEnderChest().setItem(5, new ItemStack(Material.STONE, 1));
    alice.getEnderChest().setItem(8, new ItemStack(Material.APPLE, 1));
    alice.setSneaking(true);

    var punch =
        new PlayerInteractEvent(
            alice, Action.LEFT_CLICK_BLOCK, null, enderChest, BlockFace.UP, EquipmentSlot.HAND);
    harness.server.getPluginManager().callEvent(punch);

    assertThat(punch.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    assertThat(alice.getEnderChest().getItem(0)).isEqualTo(new ItemStack(Material.APPLE, 1));
    assertThat(alice.getEnderChest().getItem(1)).isEqualTo(new ItemStack(Material.STONE, 1));
  }

  @Test
  void aPunchWithoutSneakingIsAPunch() {
    var alice = harness.playerAt("Alice", 0, 0);
    var enderChest = harness.world.getBlockAt(1, 5, 0);
    enderChest.setType(Material.ENDER_CHEST);
    alice.getEnderChest().setItem(5, new ItemStack(Material.STONE, 1));

    var punch =
        new PlayerInteractEvent(
            alice, Action.LEFT_CLICK_BLOCK, null, enderChest, BlockFace.UP, EquipmentSlot.HAND);
    harness.server.getPluginManager().callEvent(punch);

    assertThat(punch.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
    assertThat(alice.getEnderChest().getItem(5)).isEqualTo(new ItemStack(Material.STONE, 1));
  }

  @Test
  void protectedContainersAreNotSorted() {
    var alice = harness.playerAt("Alice", 0, 0);
    var enderChest = harness.world.getBlockAt(1, 5, 0);
    enderChest.setType(Material.ENDER_CHEST);
    alice.getEnderChest().setItem(5, new ItemStack(Material.STONE, 1));
    harness.land.noContainers = location -> true;

    new ContainerSorting(harness.land).sort(alice, enderChest);

    assertThat(alice.getEnderChest().getItem(5)).isEqualTo(new ItemStack(Material.STONE, 1));
    assertThat(QolHarness.messages(alice)).contains("[Sort]: This land belongs to Aegis.");
  }

  /** A double chest whose halves stand at x 10 and x 11. */
  DoubleChestInventory doubleChest() {
    var left = half(new Location(harness.world, 10, 5, 0));
    var right = half(new Location(harness.world, 11, 5, 0));
    return (DoubleChestInventory)
        Proxy.newProxyInstance(
            getClass().getClassLoader(),
            new Class<?>[] {DoubleChestInventory.class},
            (proxy, method, args) ->
                switch (method.getName()) {
                  case "getLeftSide" -> left;
                  case "getRightSide" -> right;
                  default -> throw new UnsupportedOperationException(method.getName());
                });
  }

  static Inventory half(Location at) {
    return (Inventory)
        Proxy.newProxyInstance(
            CombatAndSortPaperTest.class.getClassLoader(),
            new Class<?>[] {Inventory.class},
            (proxy, method, args) -> {
              if (method.getName().equals("getLocation")) {
                return at;
              }
              throw new UnsupportedOperationException(method.getName());
            });
  }

  @Test
  void bothHalvesOfADoubleChestMustBeOpenable() {
    var alice = harness.playerAt("Alice", 0, 0);
    var block = harness.world.getBlockAt(10, 5, 0);
    var sorting = new ContainerSorting(harness.land);

    assertThat(ContainerSorting.spans(block, doubleChest()))
        .extracting(Location::getBlockX)
        .containsExactly(10, 10, 11);
    assertThat(sorting.refusal(alice, block, doubleChest())).isEmpty();

    harness.land.noContainers = location -> location.getBlockX() == 11;
    assertThat(sorting.refusal(alice, block, doubleChest()))
        .map(PlainTextComponentSerializer.plainText()::serialize)
        .contains("This land belongs to Aegis.");
  }

  @Test
  void theSleepVoteIsVanillasWithAfkPlayersLeftOut() {
    var alice = harness.playerAt("Alice", 0, 0);
    var bob = harness.playerAt("Bob", 2, 0);

    assertThat(harness.world.getGameRuleValue(GameRules.PLAYERS_SLEEPING_PERCENTAGE)).isEqualTo(50);

    harness.afk.away.add(bob.getUniqueId());
    harness.server.getScheduler().performTicks(21);
    assertThat(bob.isSleepingIgnored()).isTrue();
    assertThat(alice.isSleepingIgnored()).isFalse();

    harness.afk.away.remove(bob.getUniqueId());
    harness.server.getScheduler().performTicks(21);
    assertThat(bob.isSleepingIgnored()).isFalse();
  }

  @Test
  void qolNeverClearsAnIgnoreFlagItDidNotSet() {
    var vanished = harness.playerAt("Ghost", 0, 0);
    vanished.setSleepingIgnored(true);

    harness.server.getScheduler().performTicks(21);

    assertThat(vanished.isSleepingIgnored()).isTrue();
  }
}
