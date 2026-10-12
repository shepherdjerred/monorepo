package com.shepherdjerred.thestorm.discord.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.discord.app.Links.Link;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Links against a real, temporary SQLite database. */
final class JooqLinkStoreTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  private static final Instant T0 = Instant.parse("2026-10-11T12:00:00Z");

  @TempDir Path directory;
  private StormDatabase database;
  private JooqLinkStore store;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("discord", getClass().getClassLoader());
    store = new JooqLinkStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void aLinkReplacesEitherSidesOldLink() {
    store.link(new Link(ALICE, 42L, false), T0).join();
    store.link(new Link(BOB, 7L, false), T0).join();
    store.link(new Link(BOB, 42L, true), T0).join();

    assertThat(store.all().join()).containsExactly(new Link(BOB, 42L, true));
  }

  @Test
  void dmsAndUnlinkingReportWhetherALinkExisted() {
    store.link(new Link(ALICE, 42L, false), T0).join();

    assertThat(store.setDms(ALICE, true).join()).isTrue();
    assertThat(store.setDms(BOB, true).join()).isFalse();
    assertThat(store.all().join()).containsExactly(new Link(ALICE, 42L, true));
    assertThat(store.unlinkDiscord(42L).join()).isTrue();
    assertThat(store.unlinkPlayer(ALICE).join()).isFalse();
    assertThat(store.all().join()).isEmpty();
  }
}
