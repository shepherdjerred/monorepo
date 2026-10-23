package com.shepherdjerred.thestorm.creative.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** {@code /creative tp} visits an open plot. A denied player cannot enter or be teleported in. */
final class CreativeAccessTest {

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
  void aMemberCanTeleportToThePlot() {
    var owner = playerAt("Owner", 6, 80, 6);
    var friend = playerAt("Friend", 0, 80, 0);
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle(owner);
    assertThat(owner.performCommand("creative member Friend")).isTrue();
    settle(owner);

    assertThat(friend.performCommand("creative tp 1;1")).isTrue();

    assertThat(settle(friend)).anyMatch(line -> line.contains("Teleported to 1;1."));
    assertHome(friend);
  }

  @Test
  void aDeniedPlayerCannotVisitOrEnter() {
    var owner = playerAt("Owner", 6, 80, 6);
    var stranger = playerAt("Stranger", 0, 80, 0);
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle(owner);
    assertThat(owner.performCommand("creative deny Stranger")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Denied Stranger on 1;1."));

    assertThat(stranger.performCommand("creative tp 1;1")).isTrue();

    var refused = settle(stranger);
    assertThat(refused).anyMatch(line -> line.contains("You cannot visit that plot."));
    assertThat(refused).noneMatch(line -> line.contains("Teleported"));
    assertThat(stranger.getLocation().getX()).isEqualTo(0);
    assertThat(stranger.getLocation().getZ()).isEqualTo(0);
    var world = server.getWorld("creative");
    assertThat(world).isNotNull();
    var home = PlotGrid.recovered().home(EAST);
    assertThat(stranger.teleport(new Location(world, home.x(), home.y(), home.z()))).isFalse();
    assertThat(settle(stranger)).anyMatch(line -> line.contains("You cannot enter that plot."));
    var walking =
        new PlayerMoveEvent(
            stranger,
            new Location(world, 0, 80, 0),
            new Location(world, home.x(), home.y(), home.z()));
    server.getPluginManager().callEvent(walking);
    assertThat(walking.isCancelled()).isTrue();
  }

  private PlayerMock playerAt(String name, double x, double y, double z) {
    var player = server.addPlayer(name);
    var world = server.getWorld("creative");
    assertThat(world).isNotNull();
    assertThat(player.teleport(new Location(world, x, y, z))).isTrue();
    return player;
  }

  private static void assertHome(PlayerMock player) {
    var home = PlotGrid.recovered().home(EAST);
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
