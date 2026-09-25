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
import org.bukkit.Material;
import org.bukkit.block.Block;
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

  /** Pending reverts in memory, like the SQLite table. */
  static final class MemoryStore implements SpellStore {
    final Map<BlockKey, TemporaryBlock> rows = new LinkedHashMap<>();

    @Override
    public CompletableFuture<List<TemporaryBlock>> temporaryBlocks() {
      return CompletableFuture.completedFuture(List.copyOf(rows.values()));
    }

    @Override
    public CompletableFuture<List<BlockKey>> saveTemporaryBlocks(List<TemporaryBlock> blocks) {
      var saved = new ArrayList<BlockKey>();
      for (var block : blocks) {
        if (rows.putIfAbsent(block.key(), block) == null) {
          saved.add(block.key());
        }
      }
      return CompletableFuture.completedFuture(saved);
    }

    @Override
    public CompletableFuture<Integer> deleteTemporaryBlocks(List<BlockKey> keys) {
      var deleted = 0;
      for (var key : keys) {
        deleted += rows.remove(key) == null ? 0 : 1;
      }
      return CompletableFuture.completedFuture(deleted);
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
    assertThat(store.rows).hasSize(2);
    assertThat(blocks.holds(wall.getFirst())).isTrue();

    harness.clock.advance(Duration.ofSeconds(9));
    blocks.sweep();
    assertThat(wall).allMatch(block -> block.getType() == Material.DEEPSLATE_BRICKS);

    harness.clock.advance(Duration.ofSeconds(1));
    blocks.sweep();
    assertThat(wall).allMatch(block -> block.getType() == Material.AIR);
    assertThat(store.rows).isEmpty();
    assertThat(blocks.holds(wall.getFirst())).isFalse();
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
  void aBlockChangedWhileItsRecordWasWrittenIsLeftAlone() {
    var block = air(0);
    // A pending revert from an earlier run already owns this position.
    store.rows.put(
        TemporaryBlocks.key(block),
        new TemporaryBlock(
            TemporaryBlocks.key(block),
            "minecraft:water[level=0]",
            "minecraft:packed_ice",
            harness.clock.instant()));

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
        new TemporaryBlock(
            key, "minecraft:air", "minecraft:packed_ice", harness.clock.instant().plusSeconds(60)));
    var ready = new boolean[1];

    blocks.recover(() -> ready[0] = true);

    assertThat(ice.getType()).isEqualTo(Material.AIR);
    assertThat(store.rows).isEmpty();
    assertThat(ready[0]).isTrue();
  }

  @Test
  void aCleanShutdownRevertsEverything() {
    var wall = List.of(air(0), air(1), air(2));
    place(wall, 120);

    blocks.revertAll();

    assertThat(wall).allMatch(block -> block.getType() == Material.AIR);
    assertThat(store.rows).isEmpty();
  }
}
