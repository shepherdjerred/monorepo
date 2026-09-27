package com.shepherdjerred.thestorm.seasonal.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.seasonal.domain.SeasonalConfig;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.random.RandomGenerator;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.BlockFace;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;

final class SeasonalDoorsTest {

  private ServerMock server;
  private SeasonalTestPlugin plugin;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    plugin =
        MockBukkit.loadWith(
            SeasonalTestPlugin.class,
            new PluginDescriptionFile("TheStorm", "test", SeasonalTestPlugin.class.getName()));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void givesOneTreatForAWorldSpawnDoorAndIgnoresOffWorld() {
    var config =
        new SeasonalConfig(
            "world",
            "America/Los_Angeles",
            List.of(
                new SeasonalConfig.Event(
                    "stormnight",
                    "Stormnight",
                    "10-28",
                    "10-31",
                    64,
                    1,
                    List.of(new SeasonalConfig.Door(1, 0, 0, "OAK_DOOR")),
                    List.of(new SeasonalConfig.Reward(SeasonalConfig.Kind.TREAT, "BREAD", 1, 1)))));
    var listener =
        new SeasonalDoors(
            plugin,
            config,
            InstantSource.fixed(Instant.parse("2026-10-29T12:00:00Z")),
            RandomGenerator.getDefault());
    var world = server.addSimpleWorld("world");
    var spawn = world.getSpawnLocation();
    var door = world.getBlockAt(spawn.getBlockX() + 1, spawn.getBlockY(), spawn.getBlockZ());
    door.setType(Material.OAK_DOOR);
    var player = server.addPlayer();
    var click =
        new PlayerInteractEvent(
            player,
            Action.RIGHT_CLICK_BLOCK,
            new ItemStack(Material.AIR),
            door,
            BlockFace.UP,
            EquipmentSlot.HAND);

    listener.onDoor(click);
    listener.onDoor(click);

    assertThat(
            player.getInventory().all(Material.BREAD).values().stream()
                .mapToInt(ItemStack::getAmount)
                .sum())
        .isEqualTo(1);
    assertThat(
            player
                .getPersistentDataContainer()
                .get(new NamespacedKey(plugin, "seasonal_stormnight"), PersistentDataType.STRING))
        .contains("2026-10-29|");

    var wilds = server.addSimpleWorld("wilds");
    var traveler = server.addPlayer();
    traveler.teleport(wilds.getSpawnLocation());
    listener.onDoor(
        new PlayerInteractEvent(
            traveler,
            Action.RIGHT_CLICK_BLOCK,
            new ItemStack(Material.AIR),
            door,
            BlockFace.UP,
            EquipmentSlot.HAND));
    assertThat(traveler.getInventory().contains(Material.BREAD)).isFalse();

    var unlisted = world.getBlockAt(spawn.getBlockX() + 2, spawn.getBlockY(), spawn.getBlockZ());
    unlisted.setType(Material.OAK_DOOR);
    var visitor = server.addPlayer();
    listener.onDoor(
        new PlayerInteractEvent(
            visitor,
            Action.RIGHT_CLICK_BLOCK,
            new ItemStack(Material.AIR),
            unlisted,
            BlockFace.UP,
            EquipmentSlot.HAND));
    assertThat(visitor.getInventory().contains(Material.BREAD)).isFalse();

    var remoteDoor = world.getBlockAt(world.getSpawnLocation().getBlockX() + 46_341, 64, 0);
    remoteDoor.setType(Material.OAK_DOOR);
    var remotePlayer = server.addPlayer();
    listener.onDoor(
        new PlayerInteractEvent(
            remotePlayer,
            Action.RIGHT_CLICK_BLOCK,
            new ItemStack(Material.AIR),
            remoteDoor,
            BlockFace.UP,
            EquipmentSlot.HAND));
    assertThat(remotePlayer.getInventory().contains(Material.BREAD)).isFalse();
  }

  @Test
  void winterVigilUsesItsOwnYearCrossingWindowAndSpruceDoor() {
    var config =
        new SeasonalConfig(
            "world",
            "America/Los_Angeles",
            List.of(
                new SeasonalConfig.Event(
                    "winter_vigil",
                    "Winter Vigil",
                    "12-24",
                    "01-01",
                    64,
                    1,
                    List.of(new SeasonalConfig.Door(8, 0, 0, "SPRUCE_DOOR")),
                    List.of(
                        new SeasonalConfig.Reward(SeasonalConfig.Kind.TREAT, "COOKIE", 2, 1)))));
    var world = server.addSimpleWorld("world");
    var spawn = world.getSpawnLocation();
    var door = world.getBlockAt(spawn.getBlockX() + 8, spawn.getBlockY(), spawn.getBlockZ());
    door.setType(Material.SPRUCE_DOOR);
    var player = server.addPlayer();
    var click =
        new PlayerInteractEvent(
            player,
            Action.RIGHT_CLICK_BLOCK,
            new ItemStack(Material.AIR),
            door,
            BlockFace.UP,
            EquipmentSlot.HAND);
    var onChristmas =
        new SeasonalDoors(
            plugin,
            config,
            InstantSource.fixed(Instant.parse("2026-12-26T12:00:00Z")),
            RandomGenerator.getDefault());
    onChristmas.onDoor(click);
    onChristmas.onDoor(click);
    assertThat(
            player.getInventory().all(Material.COOKIE).values().stream()
                .mapToInt(ItemStack::getAmount)
                .sum())
        .isEqualTo(2);

    var afterWindow =
        new SeasonalDoors(
            plugin,
            config,
            InstantSource.fixed(Instant.parse("2027-01-03T12:00:00Z")),
            RandomGenerator.getDefault());
    var lateVisitor = server.addPlayer();
    afterWindow.onDoor(
        new PlayerInteractEvent(
            lateVisitor,
            Action.RIGHT_CLICK_BLOCK,
            new ItemStack(Material.AIR),
            door,
            BlockFace.UP,
            EquipmentSlot.HAND));
    assertThat(lateVisitor.getInventory().contains(Material.COOKIE)).isFalse();
  }
}
