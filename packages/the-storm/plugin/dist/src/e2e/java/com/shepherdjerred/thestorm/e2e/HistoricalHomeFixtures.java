package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqHomeImport;
import com.shepherdjerred.thestorm.essentials.domain.home.HistoricalHome;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** Fixed offline identities for the disposable historical respawn gameplay test. */
final class HistoricalHomeFixtures {
  private HistoricalHomeFixtures() {}

  static void seed(Path content) {
    var position = new Position("world", 1000.5, 70, 1000.5, 0, 0);
    try (var database = StormDatabase.open(content.resolve("the-storm.db"))) {
      database.migrate("essentials", JooqHomeImport.class.getClassLoader());
      new JooqHomeImport(database)
          .importHomes(
              List.of(
                  new HistoricalHome(offline("HistoryBedA"), "2015", position),
                  new HistoricalHome(offline("HistoryBedA"), "town", position),
                  new HistoricalHome(offline("HistoryBedB"), "2015", position)))
          .get(30, TimeUnit.SECONDS);
      new JooqHomeImport(database)
          .importBeds(
              List.of(new HistoricalHome(offline("HistoryBedC"), "2015", position)),
              java.util.Set.of())
          .get(30, TimeUnit.SECONDS);
    } catch (Exception failure) {
      throw new IllegalStateException("Historical home fixture failed", failure);
    }
  }

  private static UUID offline(String name) {
    return UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
  }
}
