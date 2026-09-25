package com.shepherdjerred.thestorm.spells.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.spells.app.SpellStore;
import com.shepherdjerred.thestorm.spells.domain.FocusKey;
import com.shepherdjerred.thestorm.spells.domain.Waypoint;
import com.shepherdjerred.thestorm.spells.domain.temporary.BlockKey;
import com.shepherdjerred.thestorm.spells.domain.temporary.Replaceability;
import com.shepherdjerred.thestorm.spells.domain.temporary.TemporaryBlock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Zombie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Temporary blocks in a MockBukkit world, with storage faked in memory. */
final class TemporaryBlocksWorldTest {

  private final Harness harness = new Harness();
  private final MemoryStore store = new MemoryStore();
  private final TemporaryBlocks blocks =
      new TemporaryBlocks(store, harness.server, harness.clock, harness.async);

  @AfterEach
  void tearDown() {
    harness.close();
  }

  /** The SQLite table in memory: records with their reverted flag. */
  static final class MemoryStore implements SpellStore {

    record Row(TemporaryBlock block, boolean reverted) {}

    final Map<BlockKey, Row> rows = new LinkedHashMap<>();

    /** When set, saves wait until the test completes them, like a slow database. */
    CompletableFuture<Boolean> gate = CompletableFuture.completedFuture(true);

    List<TemporaryBlock> pending() {
      return rows.values().stream().filter(row -> !row.reverted()).map(Row::block).toList();
    }

    List<BlockKey> reverted() {
      return rows.entrySet().stream()
          .filter(entry -> entry.getValue().reverted())
          .map(Map.Entry::getKey)
          .toList();
    }

    @Override
    public CompletableFuture<List<TemporaryBlock>> temporaryBlocks() {
      return CompletableFuture.completedFuture(rows.values().stream().map(Row::block).toList());
    }

    @Override
    public CompletableFuture<List<BlockKey>> saveTemporaryBlocks(List<TemporaryBlock> blocks) {
      return gate.thenApply(
          ignored -> {
            var saved = new ArrayList<BlockKey>();
            for (var block : blocks) {
              var existing = rows.get(block.key());
              if (existing == null || existing.reverted()) {
                rows.put(block.key(), new Row(block, false));
                saved.add(block.key());
              }
            }
            return saved;
          });
    }

    @Override
    public CompletableFuture<Integer> deleteTemporaryBlocks(List<BlockKey> keys) {
      keys.forEach(rows::remove);
      return CompletableFuture.completedFuture(keys.size());
    }

    @Override
    public CompletableFuture<Integer> markReverted(List<BlockKey> keys) {
      for (var key : keys) {
        rows.computeIfPresent(key, (k, row) -> new Row(row.block(), true));
      }
      return CompletableFuture.completedFuture(keys.size());
    }

    @Override
    public CompletableFuture<Integer> forgetReverted(List<BlockKey> keys) {
      var forgotten = 0;
      for (var key : keys) {
        var row = rows.get(key);
        if (row != null && row.reverted()) {
          rows.remove(key);
          forgotten++;
        }
      }
      return CompletableFuture.completedFuture(forgotten);
    }

    @Override
    public CompletableFuture<Integer> forgetReverted(String world) {
      var before = rows.size();
      rows.entrySet()
          .removeIf(entry -> entry.getValue().reverted() && entry.getKey().world().equals(world));
      return CompletableFuture.completedFuture(before - rows.size());
    }

    @Override
    public CompletableFuture<Map<UUID, Waypoint>> marks() {
      return CompletableFuture.completedFuture(Map.of());
    }

    @Override
    public CompletableFuture<Integer> saveMark(UUID player, Waypoint mark) {
      return CompletableFuture.completedFuture(1);
    }

    @Override
    public CompletableFuture<Map<FocusKey, Long>> foci() {
      return CompletableFuture.completedFuture(Map.of());
    }

    @Override
    public CompletableFuture<Integer> saveFocus(FocusKey key, long generation) {
      return CompletableFuture.completedFuture(1);
    }
  }

  private Block air(int x) {
    var block = harness.world.getBlockAt(x, 100, 0);
    block.setType(Material.AIR);
    return block;
  }

  private void place(List<Block> targets, int seconds) {
    blocks.place(targets, Material.DEEPSLATE_BRICKS.createBlockData(), Duration.ofSeconds(seconds));
  }

  @Test
  void aWallIsRecordedBeforeItStandsAndRevertsWhenDue() {
    var wall = List.of(air(0), air(1));
    place(wall, 10);

    assertThat(wall).allMatch(block -> block.getType() == Material.DEEPSLATE_BRICKS);
    assertThat(store.pending()).hasSize(2);
    assertThat(blocks.holds(wall.getFirst())).isTrue();

    harness.clock.advance(Duration.ofSeconds(9));
    blocks.sweep();
    assertThat(wall).allMatch(block -> block.getType() == Material.DEEPSLATE_BRICKS);

    harness.clock.advance(Duration.ofSeconds(1));
    blocks.sweep();
    assertThat(wall).allMatch(block -> block.getType() == Material.AIR);
    assertThat(blocks.holds(wall.getFirst())).isFalse();
    // Reverted, but remembered until the world is saved.
    assertThat(store.reverted()).hasSize(2);
    assertThat(store.pending()).isEmpty();

    blocks.worldSaved(harness.world);
    assertThat(store.rows).isEmpty();
  }

  @Test
  void aCrashAfterARevertButBeforeTheSaveRevertsAgainAtStartup() {
    var block = air(0);
    place(List.of(block), 10);
    harness.clock.advance(Duration.ofSeconds(10));
    blocks.sweep();
    assertThat(block.getType()).isEqualTo(Material.AIR);

    // kill -9: the world on disk still shows the wall, and the record is still there.
    block.setType(Material.DEEPSLATE_BRICKS);
    var restarted = new TemporaryBlocks(store, harness.server, harness.clock, harness.async);
    restarted.recover(() -> {});

    assertThat(block.getType()).isEqualTo(Material.AIR);
    assertThat(store.reverted()).containsExactly(TemporaryBlocks.key(block));
  }

  @Test
  void aCrashAfterTheWorldSavedTheRevertLeavesTheWorldAlone() {
    var block = air(0);
    place(List.of(block), 10);
    harness.clock.advance(Duration.ofSeconds(10));
    blocks.sweep();
    // Someone builds where the wall stood, then the server dies before the save.
    block.setType(Material.OAK_PLANKS);

    new TemporaryBlocks(store, harness.server, harness.clock, harness.async).recover(() -> {});

    assertThat(block.getType()).isEqualTo(Material.OAK_PLANKS);
  }

  @Test
  void aSavedChunkForgetsOnlyItsOwnReverts() {
    var near = air(0);
    var far = harness.world.getBlockAt(100, 100, 0);
    far.setType(Material.AIR);
    place(List.of(near, far), 1);
    harness.clock.advance(Duration.ofSeconds(1));
    blocks.sweep();

    blocks.chunkSaved(near.getChunk());

    assertThat(store.reverted()).containsExactly(TemporaryBlocks.key(far));
  }

  @Test
  void aNewSpellMayReuseAPositionWhoseRevertAwaitsTheSave() {
    var block = air(0);
    place(List.of(block), 1);
    harness.clock.advance(Duration.ofSeconds(1));
    blocks.sweep();

    place(List.of(block), 10);

    assertThat(block.getType()).isEqualTo(Material.DEEPSLATE_BRICKS);
    assertThat(store.pending()).hasSize(1);
    blocks.worldSaved(harness.world);
    assertThat(store.pending()).hasSize(1);
  }

  @Test
  void containersAndSolidBlocksAreNeverEligible() {
    var chest = harness.world.getBlockAt(5, 100, 0);
    chest.setType(Material.CHEST);
    var stone = harness.world.getBlockAt(6, 100, 0);
    stone.setType(Material.STONE);
    var open = air(7);

    assertThat(blocks.eligible(List.of(chest, stone, open), Replaceability.Mode.OPEN_SPACE))
        .containsExactly(open);
  }

  @Test
  void aBlockAlreadyTemporaryIsNotEligibleAgain() {
    var block = air(0);
    place(List.of(block), 10);

    assertThat(blocks.eligible(List.of(block), Replaceability.Mode.OPEN_SPACE)).isEmpty();
  }

  @Test
  void freezeNeverIcesWaterACreatureIsIn() {
    var occupied = harness.world.getBlockAt(0, 100, 0);
    occupied.setType(Material.WATER);
    var free = harness.world.getBlockAt(4, 100, 0);
    free.setType(Material.WATER);
    harness.world.spawn(new Location(harness.world, 0.5, 100, 0.5), Zombie.class);

    assertThat(blocks.eligible(List.of(occupied, free), Replaceability.Mode.WATER))
        .containsExactly(free);
  }

  @Test
  void aCreatureThatStepsInWhileTheRecordIsWrittenKeepsItsSpace() {
    var gate = new CompletableFuture<Boolean>();
    store.gate = gate;
    var block = air(0);
    place(List.of(block), 10);

    harness.world.spawn(new Location(harness.world, 0.5, 100, 0.5), Zombie.class);
    gate.complete(true);

    assertThat(block.getType()).isEqualTo(Material.AIR);
    assertThat(blocks.holds(block)).isFalse();
    assertThat(store.rows).isEmpty();
  }

  @Test
  void aPendingRevertFromAnEarlierRunIsNeverOverwritten() {
    var block = air(0);
    var key = TemporaryBlocks.key(block);
    store.rows.put(
        key,
        new MemoryStore.Row(
            new TemporaryBlock(
                key, "minecraft:water[level=0]", "minecraft:packed_ice", harness.clock.instant()),
            false));

    place(List.of(block), 10);

    assertThat(block.getType()).isEqualTo(Material.AIR);
    assertThat(blocks.holds(block)).isFalse();
  }

  @Test
  void leftoversFromACrashAreRevertedAtStartup() {
    var ice = harness.world.getBlockAt(0, 100, 0);
    ice.setType(Material.PACKED_ICE);
    var key = TemporaryBlocks.key(ice);
    store.rows.put(
        key,
        new MemoryStore.Row(
            new TemporaryBlock(
                key,
                "minecraft:air",
                "minecraft:packed_ice",
                harness.clock.instant().plusSeconds(60)),
            false));
    var ready = new boolean[1];

    blocks.recover(() -> ready[0] = true);

    assertThat(ice.getType()).isEqualTo(Material.AIR);
    assertThat(store.reverted()).containsExactly(key);
    assertThat(ready[0]).isTrue();
  }

  @Test
  void leftoversInAnUnloadedWorldWaitForItToLoad() {
    var ice = harness.world.getBlockAt(0, 100, 0);
    ice.setType(Material.PACKED_ICE);
    var key = TemporaryBlocks.key(ice);
    store.rows.put(
        key,
        new MemoryStore.Row(
            new TemporaryBlock(
                key, "minecraft:air", "minecraft:packed_ice", harness.clock.instant()),
            false));
    harness.server.removeWorld(harness.world);

    blocks.recover(() -> {});
    assertThat(ice.getType()).isEqualTo(Material.PACKED_ICE);
    assertThat(store.pending()).hasSize(1);

    harness.server.addWorld(harness.world);
    blocks.worldLoaded(harness.world);

    assertThat(ice.getType()).isEqualTo(Material.AIR);
    assertThat(store.reverted()).containsExactly(key);
  }

  @Test
  void aCleanShutdownRevertsEverything() {
    var wall = List.of(air(0), air(1), air(2));
    place(wall, 120);

    blocks.revertAll();

    assertThat(wall).allMatch(block -> block.getType() == Material.AIR);
    assertThat(store.pending()).isEmpty();
  }
}
