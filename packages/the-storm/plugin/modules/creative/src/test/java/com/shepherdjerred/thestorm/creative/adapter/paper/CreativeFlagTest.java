package com.shepherdjerred.thestorm.creative.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.creative.domain.PlotFlag;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
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

/** {@code /creative flag} lets a visitor use a block and refuses an unknown name. */
final class CreativeFlagTest {

  private static final PlotId EAST = new PlotId(1, 1);

  @TempDir Path directory;

  private ServerMock server;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("creative");
    CreativeClaimCommandsPlugin.directory = directory;
    CreativeClaimCommandsPlugin.failSave = false;
    var plugin =
        MockBukkit.loadWith(
            CreativeClaimCommandsPlugin.class,
            new PluginDescriptionFile(
                "TheStorm", "test", CreativeClaimCommandsPlugin.class.getName()));
    server
        .getPluginManager()
        .registerEvents(
            new PlotGuard(
                "creative", PlotGrid.recovered(), CreativeClaimCommandsPlugin.claims(), 200),
            plugin);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void useStartsOffAndTurnsOnForAVisitor() {
    var owner = player("Owner");
    var stranger = player("Stranger");
    var world = server.getWorld("creative");
    assertThat(world).isNotNull();
    assertThat(owner.teleport(new Location(world, 6, 80, 6))).isTrue();
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle(owner);
    var block = world.getBlockAt(6, 64, 6);
    block.setType(Material.OAK_BUTTON);

    var closed = click(stranger, block, Action.RIGHT_CLICK_BLOCK);
    server.getPluginManager().callEvent(closed);
    assertThat(closed.useInteractedBlock()).isEqualTo(Event.Result.DENY);
    var breaking = click(stranger, block, Action.LEFT_CLICK_BLOCK);
    server.getPluginManager().callEvent(breaking);
    assertThat(breaking.useInteractedBlock()).isEqualTo(Event.Result.DENY);

    assertThat(owner.performCommand("creative flag use on")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Set use on for 1;1."));
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST).orElseThrow().flags())
        .contains(PlotFlag.USE);

    var open = click(stranger, block, Action.RIGHT_CLICK_BLOCK);
    server.getPluginManager().callEvent(open);
    assertThat(open.useInteractedBlock()).isNotEqualTo(Event.Result.DENY);
    var stillBreaking = click(stranger, block, Action.LEFT_CLICK_BLOCK);
    server.getPluginManager().callEvent(stillBreaking);
    assertThat(stillBreaking.useInteractedBlock()).isEqualTo(Event.Result.DENY);

    assertThat(owner.performCommand("creative flag fly on")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Unknown flag."));
    assertThat(owner.performCommand("creative flag use maybe")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Use on or off."));
    assertThat(owner.performCommand("creative flag mob-interact on")).isTrue();
    settle(owner);
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST).orElseThrow().flags())
        .contains(PlotFlag.USE, PlotFlag.MOB_INTERACT);
  }

  private PlayerMock player(String name) {
    return server.addPlayer(name);
  }

  private static PlayerInteractEvent click(PlayerMock player, Block block, Action action) {
    return new PlayerInteractEvent(
        player, action, new ItemStack(Material.AIR), block, BlockFace.UP, EquipmentSlot.HAND);
  }

  private List<String> settle(PlayerMock player) {
    var seen = new ArrayList<String>();
    for (var attempt = 0; attempt < 10; attempt++) {
      server.getScheduler().performOneTick();
      for (var message = player.nextComponentMessage();
          message != null;
          message = player.nextComponentMessage()) {
        seen.add(PlainTextComponentSerializer.plainText().serialize(message));
      }
    }
    return seen;
  }
}
