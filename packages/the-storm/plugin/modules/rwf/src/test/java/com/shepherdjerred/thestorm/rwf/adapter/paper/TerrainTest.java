package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.world.AuditedBlockChanges;
import com.shepherdjerred.thestorm.rwf.RwfHarness.CountingChunks;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapBlocks;
import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import java.lang.reflect.Proxy;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;
import org.bukkit.ChunkSnapshot;
import org.bukkit.Material;
import org.bukkit.World;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;

final class TerrainTest {

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void releaseDuringPasteStopsTheRemainingWrites() {
    var server = MockBukkit.mock();
    var plugin = MockBukkit.createMockPlugin();
    var world = server.addSimpleWorld("terrain");
    var size = new Schematic.Dimensions(Terrain.PASTE_BATCH + 1, 1, 1);
    var schematic = new Schematic(size, List.of("minecraft:stone"), new int[(int) size.blocks()]);
    var region = new Cuboid(new BlockPos(0, 70, 0), new BlockPos(size.width() - 1, 70, 0));
    var blocks = MapBlocks.resolve(schematic, region, server::createBlockData);
    var context =
        new PaperContext(
            new PaperContext.Parts(
                plugin,
                new PaperScheduler(plugin),
                new DirectComputePool(),
                InstantSource.fixed(Instant.EPOCH),
                RandomGenerator.of("L64X128MixRandom"),
                world,
                new AuditedBlockChanges(_ -> {})));
    var terrain =
        new Terrain(
            context, new Terrain.Source("test", blocks, schematic.sha256()), new CountingChunks());
    var finished = new ArrayList<Boolean>();

    terrain.paste(() -> finished.add(true));
    assertThat(world.getBlockAt(Terrain.PASTE_BATCH - 1, 70, 0).getType())
        .isEqualTo(Material.STONE);
    assertThat(world.getBlockAt(Terrain.PASTE_BATCH, 70, 0).getType()).isEqualTo(Material.AIR);
    assertThat(finished).isEmpty();
    terrain.release();
    server.getScheduler().performOneTick();

    assertThat(world.getBlockAt(Terrain.PASTE_BATCH, 70, 0).getType()).isEqualTo(Material.AIR);
    assertThat(finished).containsExactly(true);
    assertThat(terrain.ready()).isFalse();
    assertThat(terrain.busy()).isFalse();
  }

  @Test
  void hashesShuffledSnapshotsAcrossNegativeChunkBoundariesAndRejectsMissingChunks() {
    var server = MockBukkit.mock();
    var world = server.addSimpleWorld("terrain");
    var region = new Cuboid(new BlockPos(-17, 70, -1), new BlockPos(1, 70, 0));
    var schematic =
        new Schematic(
            new Schematic.Dimensions(19, 1, 2),
            List.of("minecraft:air", "minecraft:stone"),
            new int[38]);
    var blocks = MapBlocks.resolve(schematic, region, server::createBlockData);
    var coordinates =
        List.of(
            new int[] {0, 0},
            new int[] {-2, -1},
            new int[] {-1, 0},
            new int[] {0, -1},
            new int[] {-1, -1},
            new int[] {-2, 0});
    var snapshots = coordinates.stream().map(c -> snapshot(world, c)).toList();

    assertThat(Terrain.hash(region, coordinates, snapshots, blocks)).isEqualTo(schematic.sha256());
    assertThatThrownBy(
            () -> Terrain.hash(region, coordinates.subList(1, 6), snapshots.subList(1, 6), blocks))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("outside the snapshots");
    world.getBlockAt(-17, 70, -1).setType(Material.STONE);
    var changed = coordinates.stream().map(c -> snapshot(world, c)).toList();
    assertThat(Terrain.hash(region, coordinates, changed, blocks)).isNotEqualTo(schematic.sha256());
  }

  /** The Paper snapshot boundary, including local x/z and world y; WorldMock lacks this mapping. */
  private static ChunkSnapshot snapshot(World world, int[] chunk) {
    return (ChunkSnapshot)
        Proxy.newProxyInstance(
            ChunkSnapshot.class.getClassLoader(),
            new Class<?>[] {ChunkSnapshot.class},
            (proxy, method, args) -> {
              if (!method.getName().equals("getBlockData") || args == null) {
                throw new UnsupportedOperationException(method.getName());
              }
              return world
                  .getBlockAt(
                      chunk[0] * 16 + (int) args[0], (int) args[1], chunk[1] * 16 + (int) args[2])
                  .getBlockData();
            });
  }
}
