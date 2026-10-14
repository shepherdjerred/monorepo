package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.BitSet;
import java.util.List;
import org.junit.jupiter.api.Test;

final class NavModelUpgradeTest {
  private record Terrain(boolean changed) implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return BASE.bounds();
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (x == 3 && z == 3 && y >= 2 && y <= 3) return BlockShape.LADDER;
      if (changed && x == 6 && y == 1 && z == 6) return BlockShape.FULL;
      return BASE.shape(x, y, z);
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return (changed && x == 6 && y == 1 && z == 6) || BASE.blocksSight(x, y, z);
    }
  }

  private static final SyntheticMap BASE = SyntheticMap.open();
  private final Terrain terrain = new Terrain(false);
  private final NavArtifact artifact = MapBaker.bake("synthetic", terrain, SyntheticMap.sites());

  private record WithoutClimb(BlockClassification original) implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return original.bounds();
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      var shape = original.shape(x, y, z);
      return shape.climbable() ? BlockShape.PASSABLE : shape;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return original.blocksSight(x, y, z);
    }
  }

  @Test
  void exactLegacyUpgradeEqualsFreshModel4BytesAndPreservesEveryAnalysisSection()
      throws IOException {
    var upgraded = upgraded(legacy(artifact), source(terrain));
    assertThat(upgraded.bytes()).isEqualTo(NavCodec.encode(artifact));
    assertThat(upgraded.artifact().graph()).isEqualTo(artifact.graph());
    assertThat(upgraded.preservation().sections().keySet())
        .containsExactlyInAnyOrder(2, 3, 5, 6, 7, 8, 9, 10);
    var graph = upgraded.artifact().graph();
    assertThat(graph.climbable(graph.nodeAt(new BlockPos(3, 1, 3)).orElseThrow())).isFalse();
    assertThat(graph.climbable(graph.nodeAt(new BlockPos(3, 2, 3)).orElseThrow())).isTrue();
    var bytes = upgraded.bytes();
    Arrays.fill(bytes, (byte) 0);
    assertThat(upgraded.bytes()).isEqualTo(NavCodec.encode(artifact));
  }

  @Test
  void ordinaryRuntimeRejectsLegacyAndMissingCapabilitiesWhileUpgradeRejectsCurrentInput()
      throws IOException {
    var old = legacy(artifact);
    assertThat(NavCodec.decode(old)).isInstanceOf(Result.Err.class);
    assertThat(NavModelUpgrade.model3(NavCodec.encode(artifact), source(terrain)))
        .isInstanceOf(Result.Err.class);
    var raw = NavCodec.readFrame(old);
    ByteBuffer.wrap(raw).putInt(8, 4).putInt(12, 4);
    assertThat(NavCodec.decode(NavCodec.writeFrame(raw))).isInstanceOf(Result.Err.class);
  }

  @Test
  void requiresActualOriginalTerrainIdentitySitesAndVoxelLayers() throws IOException {
    var old = legacy(artifact);
    var wrongHash =
        new NavModelUpgrade.Source(
            "synthetic", "0".repeat(64), terrain, artifact.sites(), MapBaker.sha256(terrain));
    var wrongSites =
        new NavModelUpgrade.Source(
            "synthetic",
            artifact.blocksSha256(),
            terrain,
            new NavSites(List.of(), List.of()),
            MapBaker.sha256(terrain));
    assertThat(NavModelUpgrade.model3(old, wrongHash)).isInstanceOf(Result.Err.class);
    assertThat(NavModelUpgrade.model3(old, wrongSites)).isInstanceOf(Result.Err.class);
    assertThat(NavModelUpgrade.model3(old, source(new Terrain(true))))
        .isInstanceOf(Result.Err.class);
  }

  @Test
  void theLegacyClassificationDigestRejectsLaddersChangedToAirWithIdenticalVoxelLayers()
      throws IOException {
    var changed = new WithoutClimb(terrain);
    assertThat(VoxelGrid.from(changed)).isEqualTo(VoxelGrid.from(terrain));
    assertThat(MapBaker.sha256(changed)).isNotEqualTo(MapBaker.sha256(terrain));
    assertThat(NavModelUpgrade.model3(legacy(artifact), source(changed)))
        .isInstanceOf(Result.Err.class);
  }

  @Test
  void refusesCompressedCrcDamageTrailingStreamsAndMalformedLegacyGraph() throws IOException {
    var old = legacy(artifact);
    var corrupted = old.clone();
    corrupted[corrupted.length - 1] ^= 1;
    assertThat(NavModelUpgrade.model3(corrupted, source(terrain))).isInstanceOf(Result.Err.class);
    var trailing = Arrays.copyOf(old, old.length + 1);
    ByteBuffer.wrap(trailing).putInt(12, trailing.length - 16);
    assertThat(NavModelUpgrade.model3(trailing, source(terrain))).isInstanceOf(Result.Err.class);
    assertThat(NavCodec.decode(trailing)).isInstanceOf(Result.Err.class);
    var raw = NavCodec.readFrame(old);
    ByteBuffer.wrap(raw).putInt(section(raw, 4) + 8, -1);
    assertThat(NavModelUpgrade.model3(NavCodec.writeFrame(raw), source(terrain)))
        .isInstanceOf(Result.Err.class);
  }

  @Test
  void currentDecoderRejectsClimbBitsOutsideItsNodeCountAndOversizedWordCounts()
      throws IOException {
    var invalid = new BitSet();
    invalid.set(artifact.graph().nodeCount());
    var raw = replaceTail(artifact, invalid);
    assertThat(NavCodec.decode(NavCodec.writeFrame(raw))).isInstanceOf(Result.Err.class);
    var current = NavCodec.readFrame(NavCodec.encode(artifact));
    var graph = section(current, 4);
    var length = ByteBuffer.wrap(current).getInt(graph + 4);
    var tail = Integer.BYTES + Long.BYTES * artifact.graph().climbableNodes().toLongArray().length;
    ByteBuffer.wrap(current).putInt(graph + 8 + length - tail, (1 << 26));
    assertThat(NavCodec.decode(NavCodec.writeFrame(current))).isInstanceOf(Result.Err.class);
  }

  private NavModelUpgrade.Source source(BlockClassification blocks) {
    return new NavModelUpgrade.Source(
        "synthetic", artifact.blocksSha256(), blocks, artifact.sites(), MapBaker.sha256(terrain));
  }

  private static NavModelUpgrade.Upgraded upgraded(byte[] old, NavModelUpgrade.Source source) {
    return switch (NavModelUpgrade.model3(old, source)) {
      case Result.Ok<NavModelUpgrade.Upgraded, NavCodec.CodecError>(var value) -> value;
      case Result.Err<NavModelUpgrade.Upgraded, NavCodec.CodecError>(var error) ->
          throw new AssertionError(error.message());
    };
  }

  private static byte[] legacy(NavArtifact artifact) throws IOException {
    var raw = NavCodec.readFrame(NavCodec.encode(artifact));
    var graph = section(raw, 4);
    var length = ByteBuffer.wrap(raw).getInt(graph + 4);
    var tail = Integer.BYTES + Long.BYTES * artifact.graph().climbableNodes().toLongArray().length;
    var boundary = graph + 8 + length;
    var old = new byte[raw.length - tail];
    System.arraycopy(raw, 0, old, 0, boundary - tail);
    System.arraycopy(raw, boundary, old, boundary - tail, raw.length - boundary);
    ByteBuffer.wrap(old).putInt(graph + 4, length - tail).putInt(8, 3).putInt(12, 3);
    return NavCodec.writeFrame(old);
  }

  private static byte[] replaceTail(NavArtifact artifact, BitSet bits) throws IOException {
    var raw = NavCodec.readFrame(NavCodec.encode(artifact));
    var graph = section(raw, 4);
    var length = ByteBuffer.wrap(raw).getInt(graph + 4);
    var tail = Integer.BYTES + Long.BYTES * artifact.graph().climbableNodes().toLongArray().length;
    var payload = new ByteArrayOutputStream();
    NavCodec.writeBits(bits, new DataOutputStream(payload));
    var replacement = payload.toByteArray();
    var boundary = graph + 8 + length;
    var changed = new byte[raw.length - tail + replacement.length];
    System.arraycopy(raw, 0, changed, 0, boundary - tail);
    System.arraycopy(replacement, 0, changed, boundary - tail, replacement.length);
    System.arraycopy(
        raw, boundary, changed, boundary - tail + replacement.length, raw.length - boundary);
    ByteBuffer.wrap(changed).putInt(graph + 4, length - tail + replacement.length);
    return changed;
  }

  private static int section(byte[] raw, int id) {
    var offset = 0;
    while (ByteBuffer.wrap(raw).getInt(offset) != id)
      offset += 8 + ByteBuffer.wrap(raw).getInt(offset + 4);
    return offset;
  }
}
