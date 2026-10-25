package com.shepherdjerred.thestorm.creative.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.creative.domain.PlotId;
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

/** Merge, a personal schematic, and a rating stay on the plot the player owns. */
final class CreativePlayerTest {

  private static final PlotId EAST = new PlotId(1, 1);
  private static final PlotId FAR = new PlotId(2, 1);

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
  void mergeLinksOwnedNeighborsAndUnlinkWaitsForTheRoad() {
    var owner = playerAt(6, 80, 6);
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle(owner);
    assertThat(owner.teleport(new Location(owner.getWorld(), 100, 80, 45))).isTrue();
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle(owner);
    assertThat(owner.teleport(new Location(owner.getWorld(), 45, 80, 45))).isTrue();

    assertThat(owner.performCommand("creative merge 2;2")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("That plot does not touch this one."));
    assertThat(owner.performCommand("creative merge 1;2")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("That plot is not claimed."));
    assertThat(owner.performCommand("creative merge 2;1")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Merged 1;1 with 2;1."));
    assertThat(CreativeClaimCommandsPlugin.claims().merged(EAST))
        .containsExactlyInAnyOrder(EAST, FAR);

    assertThat(owner.performCommand("creative unlink")).isTrue();
    assertThat(settle(owner))
        .anyMatch(
            line -> line.contains("The road between these plots does not match the template."));
    assertThat(owner.performCommand("creative unclaim")).isTrue();
    assertThat(settle(owner))
        .anyMatch(line -> line.contains("Unlink this plot before unclaiming it."));
    assertThat(CreativeClaimCommandsPlugin.claims().row(EAST)).isPresent();
    assertThat(CreativeClaimCommandsPlugin.claims().row(FAR)).isPresent();
  }

  @Test
  void pasteRefusesAPlotThatIsNotTheTemplate() {
    var owner = playerAt(6, 80, 6);
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle(owner);
    var floor = owner.getWorld().getBlockAt(6, 64, 6);
    floor.setType(Material.DIAMOND_BLOCK);

    assertThat(owner.performCommand("creative paste house")).isTrue();
    assertThat(settle(owner))
        .anyMatch(line -> line.contains("This plot does not match the template."));
    assertThat(floor.getType()).isEqualTo(Material.DIAMOND_BLOCK);

    assertThat(owner.performCommand("creative load")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("You have no schematics."));
    assertThat(owner.performCommand("creative save a.b")).isTrue();
    assertThat(settle(owner))
        .anyMatch(line -> line.contains("Use a name of letters, numbers, _ or -"));
  }

  @Test
  void aVisitorRatesOnceAndTheOwnerDeletesTheLatestComment() {
    var owner = playerAt(6, 80, 6);
    assertThat(owner.performCommand("creative claim")).isTrue();
    settle(owner);

    assertThat(owner.performCommand("creative rate 9")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Use a rating from 1 to 5."));
    assertThat(owner.performCommand("creative rate 5")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Rated 1;1 as 5."));
    assertThat(owner.performCommand("creative rate 5")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("You already rated 1;1 as 5."));
    assertThat(owner.performCommand("creative comment A quiet dock")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Comment saved on 1;1."));

    assertThat(owner.performCommand("creative info")).isTrue();
    var info = settle(owner);
    assertThat(info).anyMatch(line -> line.contains("Rating 5.0 from 1 player."));
    assertThat(info).anyMatch(line -> line.contains("Owner: A quiet dock"));

    assertThat(owner.performCommand("creative comment delete")).isTrue();
    assertThat(settle(owner)).anyMatch(line -> line.contains("Deleted the latest comment on 1;1."));
    assertThat(owner.performCommand("creative info")).isTrue();
    assertThat(settle(owner)).noneMatch(line -> line.contains("A quiet dock"));
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
    for (var attempt = 0; attempt < 50; attempt++) {
      server.getScheduler().performOneTick();
      for (var message = player.nextComponentMessage();
          message != null;
          message = player.nextComponentMessage()) {
        seen.add(PlainTextComponentSerializer.plainText().serialize(message));
      }
      if (!seen.isEmpty()) {
        return seen;
      }
      try {
        Thread.sleep(20);
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        return seen;
      }
    }
    return seen;
  }
}
