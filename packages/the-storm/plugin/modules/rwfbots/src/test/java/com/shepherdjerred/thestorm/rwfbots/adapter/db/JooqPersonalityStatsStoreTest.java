package com.shepherdjerred.thestorm.rwfbots.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.rwfbots.app.PersonalityStats;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The store round-trips records exactly and replaces a personality's earlier row. */
final class JooqPersonalityStatsStoreTest {

  private static final Instant T0 = Instant.parse("2026-10-03T12:00:00Z");

  @TempDir Path directory;
  private StormDatabase database;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("rwfbots", getClass().getClassLoader());
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void recordsRoundTripAndSavingAgainReplaces() {
    var store = new JooqPersonalityStatsStore(database);
    var ash = new PersonalityStats("ash", 3, 2, 10, 4, 1, 2, new Rating(27.5, 7.25), T0);
    var ember = PersonalityStats.fresh("ember", Rating.DEFAULT, T0);

    store.save(List.of(ash, ember)).join();
    assertThat(store.loadAll().join()).containsExactly(ash, ember);

    var later =
        ash.afterMatch(
            true, new PersonalityStats.Tally(1, 1, 0, 1), new Rating(28, 7), T0.plusSeconds(60));
    store.save(List.of(later)).join();

    assertThat(store.loadAll().join()).containsExactly(later, ember);
  }

  @Test
  void anEmptyTableLoadsNothing() {
    assertThat(new JooqPersonalityStatsStore(database).loadAll().join()).isEmpty();
  }
}
