package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.event.Event;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
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
  void anOldSignSaysHowToSetItUp() {
    var event = rightClick(oldSign("[Lift Up]"));

    assertThat(event.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    assertThat(messages())
        .containsExactly(
            "[Elevator]: This sign isn't set up yet. Sneak and right-click it with an empty hand,"
                + " then press Done to set it up.");
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
}
