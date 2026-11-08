package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** Right-clicking mechanism signs on MockBukkit. */
final class SignClickListenerTest {

  @TempDir Path directory;

  private ServerMock server;
  private WorldMock world;
  private PlayerMock player;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    MechanicsTestPlugin.directory = directory;
    MockBukkit.loadWith(
        MechanicsTestPlugin.class,
        new PluginDescriptionFile("TheStorm", "test", MechanicsTestPlugin.class.getName()));
    world = server.addSimpleWorld("world");
    player = server.addPlayer("Alice");
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  /** A sign whose text was written without going through creation, like an old CraftBook sign. */
  private Block oldSign(String tag) {
    var block = world.getBlockAt(5, 64, 0);
    block.setType(Material.OAK_SIGN);
    var sign = (Sign) block.getState();
    sign.getSide(Side.FRONT).line(1, Component.text(tag));
    sign.update();
    return block;
  }

  private PlayerInteractEvent rightClick(Block block) {
    var event =
        new PlayerInteractEvent(
            player,
            Action.RIGHT_CLICK_BLOCK,
            ItemStack.empty(),
            block,
            BlockFace.NORTH,
            EquipmentSlot.HAND);
    server.getPluginManager().callEvent(event);
    return event;
  }

  private List<String> messages() {
    var seen = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      seen.add(PlainTextComponentSerializer.plainText().serialize(message));
    }
    return seen;
  }

  @Test
  void anOldLiftIsRecognizedWithoutRewritingOrAnImportRecord() {
    var event = rightClick(oldSign("[Lift Up]"));

    assertThat(event.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    assertThat(messages()).anySatisfy(message -> assertThat(message).contains("No lift sign"));
  }

  @Test
  void sneakingLeavesTheSignToVanillaForEditing() {
    player.setSneaking(true);

    var event = rightClick(oldSign("[Lift Up]"));

    assertThat(event.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
    assertThat(messages()).isEmpty();
  }

  @Test
  void aSignWithoutATagIsLeftAlone() {
    var event = rightClick(oldSign("Welcome"));

    assertThat(event.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
    assertThat(messages()).isEmpty();
  }

  @Test
  void anUnsignedLiftDoesNotAcquireAnOwnerFromAClick() {
    world.loadChunk(10, -8);
    var bottom = world.getBlockAt(160, 68, -122);
    bottom.setType(Material.OAK_SIGN);
    var sign = (Sign) bottom.getState();
    sign.getSide(Side.FRONT).line(1, Component.text("[Lift Up]"));
    sign.update();
    player.teleport(new Location(world, 161.5, 68, -121.5));

    rightClick(bottom);

    assertThat(messages()).anySatisfy(message -> assertThat(message).contains("No lift sign"));
    var plugin = Objects.requireNonNull(server.getPluginManager().getPlugin("TheStorm"));
    assertThat(
            ((Sign) bottom.getState())
                .getPersistentDataContainer()
                .get(new NamespacedKey(plugin, "mechanic_owner"), PersistentDataType.STRING))
        .isNull();
  }

  @Test
  void aChangedHistoricalSignIsNotClaimed() {
    var block = world.getBlockAt(160, 68, -122);
    block.setType(Material.OAK_SIGN);
    var sign = (Sign) block.getState();
    sign.getSide(Side.FRONT).line(1, Component.text("[Lift Up]"));
    sign.getSide(Side.FRONT).line(3, Component.text("changed"));
    sign.update();

    rightClick(block);

    assertThat(messages()).anySatisfy(message -> assertThat(message).contains("No lift sign"));
    var plugin = Objects.requireNonNull(server.getPluginManager().getPlugin("TheStorm"));
    assertThat(
            ((Sign) block.getState())
                .getPersistentDataContainer()
                .has(new NamespacedKey(plugin, "mechanic_owner")))
        .isFalse();
  }
}
