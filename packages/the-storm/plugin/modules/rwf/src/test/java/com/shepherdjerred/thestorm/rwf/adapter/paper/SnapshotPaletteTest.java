package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.adapter.content.MapBlocks;
import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.block.data.BlockData;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

final class SnapshotPaletteTest {
  @Test
  void equalSnapshotStatesNeedOnlyOneCanonicalStringAndKeepDistinctProperties() {
    var reads = new AtomicInteger();
    var blocks = blocks(reads);
    reads.set(0);
    var palette = new SnapshotPalette(blocks);
    assertThat(palette.index(state("minecraft:oak_log[axis=x]", reads))).isZero();
    assertThat(palette.index(state("minecraft:oak_log[axis=x]", reads))).isZero();
    assertThat(palette.index(state("minecraft:oak_log[axis=y]", reads))).isEqualTo(1);
    assertThat(palette.index(state("minecraft:oak_log[axis=y]", reads))).isEqualTo(1);
    assertThat(reads.get()).isEqualTo(2);
  }

  @Test
  void unknownStatesStillRejectTheTerrainAndDoNotPolluteTheKnownPalette() {
    var reads = new AtomicInteger();
    var palette = new SnapshotPalette(blocks(reads));
    assertThat(palette.index(state("minecraft:air", reads))).isEqualTo(-1);
    assertThat(palette.index(state("minecraft:oak_log[axis=x]", reads))).isZero();
    assertThat(palette.index(state("minecraft:oak_log[axis=y]", reads))).isEqualTo(1);
  }

  private static MapBlocks blocks(AtomicInteger reads) {
    var schematic =
        new Schematic(
            new Schematic.Dimensions(2, 1, 1),
            List.of("minecraft:oak_log[axis=x]", "minecraft:oak_log[axis=y]"),
            new int[] {0, 1});
    return MapBlocks.resolve(
        schematic,
        new Cuboid(new BlockPos(-1, 70, 0), new BlockPos(0, 70, 0)),
        name -> state(name, reads));
  }

  private static BlockData state(String canonical, AtomicInteger reads) {
    return (BlockData)
        Proxy.newProxyInstance(
            BlockData.class.getClassLoader(),
            new Class<?>[] {BlockData.class},
            new State(canonical, reads));
  }

  /** Mirrors the pinned Paper equality/hash contract without an actual server or mutable key. */
  private record State(String canonical, AtomicInteger reads) implements InvocationHandler {
    @Override
    public Object invoke(Object proxy, Method method, Object @Nullable [] args) {
      return switch (method.getName()) {
        case "getAsString" -> {
          reads.incrementAndGet();
          yield canonical;
        }
        case "hashCode" -> canonical.hashCode();
        case "equals" -> equalState(args);
        default -> throw new UnsupportedOperationException(method.getName());
      };
    }

    private boolean equalState(Object @Nullable [] args) {
      return args != null
          && args[0] != null
          && Proxy.isProxyClass(args[0].getClass())
          && Proxy.getInvocationHandler(args[0]) instanceof State other
          && canonical.equals(other.canonical());
    }
  }
}
