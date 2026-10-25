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

/** Clear rewrites a plot, reset does not, and unclaim waits for the generator. */
final class CreativeClearTest {

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
  void clearRestoresThePlotAndLeavesTheRoad() {
    var owner = playerAt(6, 80, 6);
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle(owner);
    assertThat(owner.performCommand("creative name Harbor")).isTrue();
    settle(owner);
    var world = owner.getWorld();
    var build = world.getBlockAt(6, 80, 6);
    var floor = world.getBlockAt(6, 64, 6);
    var road = world.getBlockAt(0, 64, 0);
    build.setType(Material.OAK_PLANKS);
    road.setType(Material.DIAMOND_BLOCK);

    assertThat(owner.performCommand("creative clear")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Run /creative clear confirm"));
    assertThat(build.getType()).isEqualTo(Material.OAK_PLANKS);
    assertThat(road.getType()).isEqualTo(Material.DIAMOND_BLOCK);

    assertThat(owner.performCommand("creative clear confirm")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Cleared 1;1."));
    assertThat(build.getType()).isEqualTo(Material.AIR);
    assertThat(floor.getType()).isEqualTo(Material.GRASS_BLOCK);
    assertThat(road.getType()).isEqualTo(Material.DIAMOND_BLOCK);

    assertThat(owner.performCommand("creative floor sand")).isTrue();
    settle(owner);
    assertThat(owner.performCommand("creative clear confirm")).isTrue();
    settle(owner);
    assertThat(floor.getType()).isEqualTo(Material.SAND);
    assertThat(road.getType()).isEqualTo(Material.DIAMOND_BLOCK);
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST).orElseThrow().name())
        .isEqualTo("Harbor");

    assertThat(owner.performCommand("creative reset")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Reset 1;1."));
    assertThat(floor.getType()).isEqualTo(Material.SAND);
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST).orElseThrow().surface())
        .isEqualTo(PlotSurface.DEFAULT);
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST).orElseThrow().name())
        .isEqualTo("Harbor");

    assertThat(owner.performCommand("creative unclaim")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("does not match the template"));
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST)).isPresent();

    assertThat(owner.performCommand("creative clear confirm")).isTrue();
    settle(owner);
    assertThat(floor.getType()).isEqualTo(Material.GRASS_BLOCK);
    assertThat(owner.performCommand("creative unclaim")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Unclaimed 1;1."));
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST)).isEmpty();
    assertThat(road.getType()).isEqualTo(Material.DIAMOND_BLOCK);
  }

  private PlayerMock playerAt(double x, double y, double z) {
    var player = server.addPlayer("Owner");
    var world = server.getWorld("creative");
    assertThat(world).isNotNull();
    assertThat(player.teleport(new Location(world, x, y, z))).isTrue();
    return player;
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
