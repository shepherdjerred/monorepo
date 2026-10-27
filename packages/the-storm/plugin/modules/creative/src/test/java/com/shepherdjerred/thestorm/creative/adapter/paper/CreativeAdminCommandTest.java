package com.shepherdjerred.thestorm.creative.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.RecoveredPlot;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
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

/** Console unclaim drops the marker, clear writes first, and a move refuses an occupied cell. */
final class CreativeAdminCommandTest {

  private static final PlotId EAST = new PlotId(1, 1);
  private static final PlotId OTHER = new PlotId(2, 2);
  private static final PlotId CATALOG = new PlotId(4, 4);
  private static final UUID CATALOG_OWNER = UUID.fromString("11111111-1111-1111-1111-111111111111");

  @TempDir Path directory;

  private ServerMock server;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    server.addSimpleWorld("creative");
    CreativeClaimCommandsPlugin.directory = directory;
    CreativeClaimCommandsPlugin.failSave = false;
    CreativeClaimCommandsPlugin.catalog =
        List.of(new RecoveredPlot(CATALOG.text(), CATALOG_OWNER.toString(), List.of()));
    MockBukkit.loadWith(
        CreativeClaimCommandsPlugin.class,
        new PluginDescriptionFile("TheStorm", "test", CreativeClaimCommandsPlugin.class.getName()));
  }

  @AfterEach
  void stop() {
    CreativeClaimCommandsPlugin.catalog = List.of();
    MockBukkit.unmock();
  }

  @Test
  void consoleUnclaimDropsTheMarker() {
    assertThat(console("creative admin unclaim 4;4")).isTrue();
    settle();
    assertThat(consoleLines()).anyMatch(line -> line.contains("Released 4;4."));
    var book = CreativeClaimCommandsPlugin.claims();
    assertThat(book.view(CATALOG).marked()).isFalse();
    assertThat(book.row(CATALOG).orElseThrow().released()).isTrue();

    var owner = playerAt(6, 80, 6);
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle();
    assertThat(console("creative admin unclaim 1;1")).isTrue();
    settle();
    assertThat(book.view(EAST).marked()).isFalse();
    assertThat(book.row(EAST)).isEmpty();
  }

  @Test
  void clearWritesTheEmptyPlotBeforeTheReleaseIsSaved() {
    var world = server.getWorld("creative");
    assertThat(world).isNotNull();
    var build = world.getBlockAt(296, 80, 282);
    var bush = world.getBlockAt(296, 65, 282);
    var road = world.getBlockAt(276, 64, 276);
    build.setType(Material.OAK_PLANKS);
    road.setType(Material.DIAMOND_BLOCK);
    CreativeClaimCommandsPlugin.failSave = true;

    assertThat(console("creative admin clear confirm 4;4")).isTrue();
    assertThat(bush.getType()).isEqualTo(Material.DEAD_BUSH);
    assertThat(build.getType()).isEqualTo(Material.AIR);
    assertThat(road.getType()).isEqualTo(Material.DIAMOND_BLOCK);
    settle();
    assertThat(CreativeClaimCommandsPlugin.claims().view(CATALOG).marked()).isTrue();
    assertThat(bush.getType()).isEqualTo(Material.DEAD_BUSH);
  }

  @Test
  void moveOntoAnOccupiedCellChangesNothing() {
    var owner = playerAt(6, 80, 6);
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle();
    assertThat(owner.teleport(new Location(owner.getWorld(), 98, 80, 98))).isTrue();
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle();
    var build = owner.getWorld().getBlockAt(20, 80, 6);
    build.setType(Material.OAK_PLANKS);

    assertThat(console("creative admin move 1;1 2;2")).isTrue();
    assertThat(consoleLines()).anyMatch(line -> line.contains("already claimed"));
    var book = CreativeClaimCommandsPlugin.claims();
    assertThat(book.view(EAST).marked()).isTrue();
    assertThat(book.view(OTHER).marked()).isTrue();
    assertThat(build.getType()).isEqualTo(Material.OAK_PLANKS);
  }

  private boolean console(String command) {
    return server.dispatchCommand(server.getConsoleSender(), command);
  }

  private List<String> consoleLines() {
    var seen = new ArrayList<String>();
    var console = server.getConsoleSender();
    for (var message = console.nextComponentMessage();
        message != null;
        message = console.nextComponentMessage()) {
      seen.add(PlainTextComponentSerializer.plainText().serialize(message));
    }
    return seen;
  }

  private PlayerMock playerAt(double x, double y, double z) {
    var player = server.addPlayer("Owner");
    var world = server.getWorld("creative");
    assertThat(world).isNotNull();
    assertThat(player.teleport(new Location(world, x, y, z))).isTrue();
    return player;
  }

  private void settle() {
    for (var attempt = 0; attempt < 10; attempt++) {
      server.getScheduler().performOneTick();
    }
  }
}
