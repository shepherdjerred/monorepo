package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqTownsStore;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import com.shepherdjerred.thestorm.towns.domain.region.RegionProfile;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class HistoricalTownOwnerTest extends AegisServer {
  private static final UUID OWNER = UUID.fromString("00000000-0000-4000-8000-0000000000c0");

  @Override
  TownsTestPlugin load() {
    try (var database = StormDatabase.open(directory.resolve("t.db"))) {
      database.migrate("towns", HistoricalTownOwnerTest.class.getClassLoader());
      var site =
          new HeritageSite(
              "old-town",
              "OldTown",
              HeritageSite.Kind.PLAYER,
              "OldTown",
              "world",
              RegionProfile.SAFE,
              Set.of(new HeritageSite.Chunk(100, 100)),
              List.of(),
              Set.of(),
              List.of(new HeritageSite.Editor(OWNER, "Carol")),
              "Survey");
      new JooqTownsStore(database)
          .importHeritage(List.of(site), Instant.EPOCH)
          .get(10, TimeUnit.SECONDS);
    } catch (Exception failure) {
      throw new IllegalStateException(failure);
    }
    return super.load();
  }

  @Test
  void returningOwnerCanSeeTheTownAndInviteAResident() throws InterruptedException {
    var owner = new PlayerMock(server, "Carol", OWNER);
    server.addPlayer(owner);
    plugin.know(OWNER, "Carol");
    assertThat(server.dispatchCommand(owner, "town")).isTrue();
    awaitLine(owner, "OldTown:");
    assertThat(server.dispatchCommand(owner, "town invite Bob")).isTrue();
    awaitLine(bob, "Carol invited you to OldTown.");
    assertThat(server.dispatchCommand(bob, "town accept OldTown")).isTrue();
    awaitLine(bob, "You joined OldTown.");
  }
}
