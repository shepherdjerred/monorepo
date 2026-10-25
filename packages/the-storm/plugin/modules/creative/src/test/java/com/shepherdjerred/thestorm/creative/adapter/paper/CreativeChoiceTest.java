package com.shepherdjerred.thestorm.creative.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotSurface;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** {@code /creative floor} stores a choice and leaves the blocks alone. */
final class CreativeChoiceTest {

  private static final PlotId EAST = new PlotId(1, 1);

  @TempDir Path directory;

  private ServerMock server;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("creative");
    CreativeClaimCommandsPlugin.directory = directory;
    CreativeClaimCommandsPlugin.failSave = false;
    MockBukkit.loadWith(
        CreativeClaimCommandsPlugin.class,
        new PluginDescriptionFile("TheStorm", "test", CreativeClaimCommandsPlugin.class.getName()));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void floorStoresTheChoiceAndLeavesTheBlock() {
    var owner = server.addPlayer("Owner");
    var world = server.getWorld("creative");
    assertThat(world).isNotNull();
    assertThat(owner.teleport(new Location(world, 6, 80, 6))).isTrue();
    var floor = world.getBlockAt(6, 64, 6);
    var before = floor.getType();
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle(owner);

    assertThat(owner.performCommand("creative floor sand")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Set the floor of 1;1 to sand."));
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST).orElseThrow().surface().floor())
        .contains("minecraft:sand");
    assertThat(floor.getType()).isEqualTo(before);

    assertThat(owner.performCommand("creative floor wool")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Unknown floor."));
    assertThat(floor.getType()).isEqualTo(before);

    assertThat(owner.performCommand("creative floor grass")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Set the floor of 1;1 to grass."));
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST).orElseThrow().surface())
        .isEqualTo(PlotSurface.DEFAULT);
    assertThat(floor.getType()).isEqualTo(before);
    assertThat(before).isNotEqualTo(Material.SAND);
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
