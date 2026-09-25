package com.shepherdjerred.thestorm.spells.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.spells.domain.FocusKey;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.Waypoint;
import com.shepherdjerred.thestorm.spells.domain.temporary.BlockKey;
import com.shepherdjerred.thestorm.spells.domain.temporary.TemporaryBlock;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqSpellStoreTest {

  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00.123Z");
  private static final UUID ALICE = new UUID(0, 1);
  private static final UUID BOB = new UUID(0, 2);
  private static final String WORLD = "minecraft:overworld";

  @TempDir Path directory;

  private StormDatabase database;
  private JooqSpellStore store;

  @BeforeEach
  void open() {
    reopen();
  }

  @AfterEach
  void close() {
    database.close();
  }

  private void reopen() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("spells", JooqSpellStoreTest.class.getClassLoader());
    store = new JooqSpellStore(database);
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }

  private static TemporaryBlock block(int x, String placed) {
    return new TemporaryBlock(
        new BlockKey(WORLD, x, 64, -3), "minecraft:air", placed, NOW.plusSeconds(x));
  }

  @Test
  void pendingRevertsSurviveARestart() throws Exception {
    var wall =
        List.of(block(1, "minecraft:deepslate_bricks"), block(2, "minecraft:deepslate_bricks"));
    assertThat(await(store.saveTemporaryBlocks(wall)))
        .containsExactly(wall.get(0).key(), wall.get(1).key());

    // The server crashes: nothing reverted, nothing forgotten.
    database.close();
    reopen();

    assertThat(await(store.temporaryBlocks())).containsExactlyElementsOf(wall);
  }

  @Test
  void revertedBlocksAreForgotten() throws Exception {
    var first = block(1, "minecraft:packed_ice");
    var second = block(2, "minecraft:packed_ice");
    await(store.saveTemporaryBlocks(List.of(first, second)));

    assertThat(await(store.deleteTemporaryBlocks(List.of(first.key())))).isEqualTo(1);
    assertThat(await(store.deleteTemporaryBlocks(List.of(first.key())))).isZero();
    assertThat(await(store.temporaryBlocks())).containsExactly(second);
  }

  @Test
  void aPositionWithAPendingRevertIsNotOverwritten() throws Exception {
    var left = block(1, "minecraft:packed_ice");
    await(store.saveTemporaryBlocks(List.of(left)));
    var newer = block(1, "minecraft:white_wool");
    var elsewhere = block(3, "minecraft:white_wool");

    assertThat(await(store.saveTemporaryBlocks(List.of(newer, elsewhere))))
        .containsExactly(elsewhere.key());
    assertThat(await(store.temporaryBlocks())).containsExactly(left, elsewhere);
  }

  @Test
  void revertTimesKeepMillisecondPrecision() throws Exception {
    var block = block(5, "minecraft:tinted_glass");
    await(store.saveTemporaryBlocks(List.of(block)));

    assertThat(await(store.temporaryBlocks()).getFirst().revertAt()).isEqualTo(NOW.plusSeconds(5));
  }

  @Test
  void aMarkIsReplacedByTheNextMark() throws Exception {
    var first = new Waypoint(WORLD, 1.5, 64, -2.5, 90, 10);
    var second = new Waypoint("minecraft:the_nether", 8, 70, 8, -45, 0);
    await(store.saveMark(ALICE, first));
    await(store.saveMark(BOB, first));
    await(store.saveMark(ALICE, second));

    database.close();
    reopen();

    assertThat(await(store.marks())).containsOnly(Map.entry(ALICE, second), Map.entry(BOB, first));
  }

  @Test
  void focusBindsKeepOnlyTheLatestGeneration() throws Exception {
    var wall = new FocusKey(ALICE, SpellKind.WALL);
    var blink = new FocusKey(ALICE, SpellKind.BLINK);
    await(store.saveFocus(wall, 1));
    await(store.saveFocus(wall, 2));
    await(store.saveFocus(blink, 1));

    database.close();
    reopen();

    assertThat(await(store.foci())).containsOnly(Map.entry(wall, 2L), Map.entry(blink, 1L));
  }

  @Test
  void anEmptyDatabaseHasNothingPending() throws Exception {
    assertThat(await(store.temporaryBlocks())).isEmpty();
    assertThat(await(store.marks())).isEmpty();
    assertThat(await(store.foci())).isEmpty();
  }
}
