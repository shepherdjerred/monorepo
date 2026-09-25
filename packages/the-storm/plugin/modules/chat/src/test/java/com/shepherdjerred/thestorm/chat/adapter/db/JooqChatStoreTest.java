package com.shepherdjerred.thestorm.chat.adapter.db;

import static com.shepherdjerred.thestorm.chat.adapter.db.generated.Tables.CHAT_MUTE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.Mute;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqChatStoreTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");

  @TempDir Path directory;

  private StormDatabase database;
  private JooqChatStore store;
  private final ArrayList<Throwable> failures = new ArrayList<>();

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("chat", JooqChatStoreTest.class.getClassLoader());
    store = new JooqChatStore(database, failures::add);
  }

  @AfterEach
  void close() {
    database.close();
  }

  @Test
  void emptyDatabaseLoadsNothing() throws Exception {
    var snapshot = store.loadAll(NOW, ChannelKey.GLOBAL).get(5, TimeUnit.SECONDS);

    assertThat(snapshot.profiles()).isEmpty();
    assertThat(snapshot.mutes()).isEmpty();
  }

  @Test
  void profilesRoundTripAndReplaceEarlierRows() throws Exception {
    var first =
        new ChatProfile(
            ChannelKey.WAR, Set.of(ChannelKey.GLOBAL, ChannelKey.STAFF), Map.of(BOB, "Bob"));
    var second = new ChatProfile(ChannelKey.GLOBAL, Set.of(ChannelKey.WAR), Map.of());

    store.writeProfile(ALICE, first).get(5, TimeUnit.SECONDS);
    assertThat(store.loadAll(NOW, ChannelKey.GLOBAL).get(5, TimeUnit.SECONDS).profiles())
        .containsExactlyEntriesOf(Map.of(ALICE, first));

    store.writeProfile(ALICE, second).get(5, TimeUnit.SECONDS);
    assertThat(store.loadAll(NOW, ChannelKey.GLOBAL).get(5, TimeUnit.SECONDS).profiles())
        .containsExactlyEntriesOf(Map.of(ALICE, second));
  }

  @Test
  void mutesRoundTripAndEndedOnesAreDeleted() throws Exception {
    var active = Mute.starting(NOW, Duration.ofHours(1), "spam", "Carol");
    var ended = Mute.starting(NOW.minusSeconds(7200), Duration.ofHours(1), "old", "Carol");
    store.writeMute(ALICE, active).get(5, TimeUnit.SECONDS);
    store.writeMute(BOB, ended).get(5, TimeUnit.SECONDS);

    var snapshot = store.loadAll(NOW, ChannelKey.GLOBAL).get(5, TimeUnit.SECONDS);

    assertThat(snapshot.mutes()).containsExactlyEntriesOf(Map.of(ALICE, active));
    var remaining = database.read(dsl -> dsl.fetchCount(CHAT_MUTE)).get(5, TimeUnit.SECONDS);
    assertThat(remaining).isEqualTo(1);
  }

  @Test
  void aNewMuteReplacesTheOldOneAndCanBeRemoved() throws Exception {
    store
        .writeMute(ALICE, Mute.starting(NOW, Duration.ofHours(1), "spam", "Carol"))
        .get(5, TimeUnit.SECONDS);
    var longer = Mute.starting(NOW, Duration.ofDays(1), "spam again", "Dave");
    store.writeMute(ALICE, longer).get(5, TimeUnit.SECONDS);

    assertThat(store.loadAll(NOW, ChannelKey.GLOBAL).get(5, TimeUnit.SECONDS).mutes())
        .containsExactlyEntriesOf(Map.of(ALICE, longer));

    store.removeMute(ALICE).get(5, TimeUnit.SECONDS);

    assertThat(store.loadAll(NOW, ChannelKey.GLOBAL).get(5, TimeUnit.SECONDS).mutes()).isEmpty();
  }

  @Test
  void fireAndForgetWritesLand() throws Exception {
    store.saveProfile(ALICE, ChatProfile.fresh(ChannelKey.WAR));
    store.saveMute(BOB, Mute.starting(NOW, Duration.ofHours(1), "spam", "Carol"));
    store.deleteMute(BOB);

    var snapshot = store.loadAll(NOW, ChannelKey.GLOBAL).get(5, TimeUnit.SECONDS);

    assertThat(snapshot.profiles()).containsKey(ALICE);
    assertThat(snapshot.mutes()).isEmpty();
    assertThat(failures).isEmpty();
  }
}
