package com.shepherdjerred.thestorm.skills.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.skills.app.BlockMove;
import com.shepherdjerred.thestorm.skills.app.BlockPosition;
import com.shepherdjerred.thestorm.skills.domain.Experience;
import com.shepherdjerred.thestorm.skills.domain.Skill;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqSkillLevelsTest {

  @TempDir Path directory;
  private StormDatabase database;
  private JooqSkillLevels levels;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("skills.db"));
    database.migrate("skills", getClass().getClassLoader());
    levels = new JooqSkillLevels(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(30, TimeUnit.SECONDS);
  }

  @Test
  void awardsArePersistentAndSerialized() throws Exception {
    var player = new UUID(0, 1);
    assertThat(await(levels.progress(player)).powerLevel()).isZero();
    var first = levels.award(player, "Alice", Skill.MINING, 60);
    var second = levels.award(player, "Alice", Skill.MINING, 60);
    await(first);
    await(second);
    var state = await(levels.progress(player));
    assertThat(state.experience()).containsEntry(Skill.MINING, 120L);
    assertThat(state.level(Skill.MINING)).isEqualTo(1);
    assertThat(state.powerLevel()).isEqualTo(1);
  }

  @Test
  void ranksTotalLevelsAndUsesLatestName() throws Exception {
    var alice = new UUID(0, 1);
    var bob = new UUID(0, 2);
    await(levels.award(alice, "OldName", Skill.MINING, 100));
    await(levels.award(alice, "Alice", Skill.FISHING, 100));
    await(levels.award(bob, "Bob", Skill.WOODCUTTING, 100));
    var ranking = await(levels.top(1));
    assertThat(ranking).hasSize(1);
    assertThat(ranking.getFirst().name()).isEqualTo("Alice");
    assertThat(ranking.getFirst().powerLevel()).isEqualTo(2);
  }

  @Test
  void capIsStoredWithoutOverflow() throws Exception {
    var player = new UUID(0, 3);
    long cap = Experience.required(Experience.MAX_LEVEL);
    int rounds = (int) (cap / Integer.MAX_VALUE) + 1;
    for (int i = 0; i < rounds; i++) {
      await(levels.award(player, "Max", Skill.REPAIR, Integer.MAX_VALUE));
    }
    assertThat(await(levels.progress(player)).experience()).containsEntry(Skill.REPAIR, cap);
  }

  @Test
  void placedBlocksRemainIneligibleAcrossStoreInstances() throws Exception {
    var placed = new BlockPosition(new UUID(2, 1), 17, 80, -30);
    var natural = new BlockPosition(new UUID(2, 1), 18, 80, -30);
    assertThat(await(levels.markPlaced(placed))).isTrue();
    database.close();
    database = StormDatabase.open(directory.resolve("skills.db"));
    database.migrate("skills", getClass().getClassLoader());
    var afterRestart = new JooqSkillLevels(database);
    assertThat(await(afterRestart.wasPlacedAndForget(placed))).isTrue();
    assertThat(await(afterRestart.wasPlacedAndForget(placed))).isFalse();
    assertThat(await(afterRestart.wasPlacedAndForget(natural))).isFalse();
  }

  @Test
  void pistonChainMovesOnlyPlacedMarkersAtomically() throws Exception {
    var world = new UUID(2, 2);
    var first = new BlockPosition(world, 10, 64, 10);
    var second = new BlockPosition(world, 11, 64, 10);
    var third = new BlockPosition(world, 12, 64, 10);
    assertThat(await(levels.markPlaced(first))).isTrue();
    await(levels.movePlaced(List.of(new BlockMove(first, second), new BlockMove(second, third))));
    assertThat(await(levels.wasPlacedAndForget(first))).isFalse();
    assertThat(await(levels.wasPlacedAndForget(second))).isTrue();
    assertThat(await(levels.wasPlacedAndForget(third))).isFalse();

    assertThat(await(levels.markPlaced(first))).isTrue();
    assertThat(await(levels.markPlaced(second))).isTrue();
    await(levels.movePlaced(List.of(new BlockMove(first, second), new BlockMove(second, third))));
    assertThat(await(levels.wasPlacedAndForget(first))).isFalse();
    assertThat(await(levels.wasPlacedAndForget(second))).isTrue();
    assertThat(await(levels.wasPlacedAndForget(third))).isTrue();
  }

  @Test
  void grownTreeLogsInheritPlacedSaplingMarker() throws Exception {
    var world = new UUID(2, 3);
    var sapling = new BlockPosition(world, 10, 64, 10);
    var naturalSapling = new BlockPosition(world, 20, 64, 20);
    var trunk = new BlockPosition(world, 10, 64, 10);
    var branch = new BlockPosition(world, 11, 66, 10);
    var naturalLog = new BlockPosition(world, 20, 64, 20);
    assertThat(await(levels.markPlaced(sapling))).isTrue();
    assertThat(await(levels.growPlacedTree(List.of(sapling), List.of(trunk, branch)))).isTrue();
    assertThat(await(levels.wasPlacedAndForget(trunk))).isTrue();
    assertThat(await(levels.wasPlacedAndForget(branch))).isTrue();
    assertThat(await(levels.growPlacedTree(List.of(naturalSapling), List.of(naturalLog))))
        .isFalse();
    assertThat(await(levels.wasPlacedAndForget(naturalLog))).isFalse();
  }

  @Test
  void fallingBlockDetachesSourceBeforeLanding() throws Exception {
    var world = new UUID(2, 4);
    var source = new BlockPosition(world, 4, 80, 4);
    var destination = new BlockPosition(world, 4, 70, 4);
    var entity = new UUID(3, 4);
    assertThat(await(levels.markPlaced(source))).isTrue();
    assertThat(await(levels.launchFalling(source, entity))).isTrue();
    assertThat(await(levels.markPlaced(source))).isTrue();
    assertThat(await(levels.landFalling(entity, destination))).isTrue();
    assertThat(await(levels.wasPlacedAndForget(source))).isTrue();
    assertThat(await(levels.wasPlacedAndForget(destination))).isTrue();
    assertThat(await(levels.landFalling(entity, destination))).isFalse();
  }
}
