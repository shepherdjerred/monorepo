package com.shepherdjerred.thestorm.creative.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** {@code /creative claim} and {@code /creative auto} arrive at the plot home after the save. */
final class CreativeClaimTeleportTest {

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
  void claimTeleportsToThePlotHomeAfterTheSave() {
    var player = playerAt(6, 80, 6);
    assertThat(player.performCommand("creative claim")).isTrue();

    var seen = settle(player);

    assertThat(seen).anyMatch(line -> line.contains("You claimed 1;1."));
    assertThat(seen).anyMatch(line -> line.contains("Teleported to 1;1."));
    assertHome(player, EAST);
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST)).isPresent();
  }

  @Test
  void autoTeleportsToTheNearestFreePlot() {
    var player = playerAt(0, 80, 0);
    assertThat(player.performCommand("creative auto")).isTrue();

    var seen = settle(player);

    assertThat(seen).anyMatch(line -> line.contains("You claimed 1;1."));
    assertThat(seen).anyMatch(line -> line.contains("Teleported to 1;1."));
    assertHome(player, EAST);
  }

  @Test
  void aFailedSaveLeavesThePlayerWhereTheyStood() {
    var player = playerAt(6, 80, 6);
    CreativeClaimCommandsPlugin.failSave = true;
    assertThat(player.performCommand("creative claim")).isTrue();

    var seen = settle(player);

    assertThat(seen).anyMatch(line -> line.contains("That could not be saved."));
    assertThat(seen).noneMatch(line -> line.contains("Teleported"));
    assertThat(player.getLocation().getX()).isEqualTo(6);
    assertThat(player.getLocation().getY()).isEqualTo(80);
    assertThat(player.getLocation().getZ()).isEqualTo(6);
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST)).isEmpty();
  }

  private PlayerMock playerAt(double x, double y, double z) {
    var player = server.addPlayer("Builder");
    var world = server.getWorld("creative");
    assertThat(world).isNotNull();
    assertThat(player.teleport(new Location(world, x, y, z))).isTrue();
    return player;
  }

  private static void assertHome(PlayerMock player, PlotId id) {
    var home = PlotGrid.recovered().home(id);
    var at = player.getLocation();
    assertThat(at.getWorld().getName()).isEqualTo("creative");
    assertThat(at.getX()).isEqualTo(home.x());
    assertThat(at.getY()).isEqualTo(home.y());
    assertThat(at.getZ()).isEqualTo(home.z());
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
