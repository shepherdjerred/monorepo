package com.shepherdjerred.thestorm.skylands.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class IslandChunkTest {

  private static IslandChunk withStone(int x, int z, int from, int to) {
    var solid = new boolean[16 * 16 * SkyTerrain.HEIGHT];
    for (var y = from; y <= to; y++) {
      solid[(x << 11) | (z << 7) | y] = true;
    }
    return new IslandChunk(solid);
  }

  @Test
  void reportsTheHighestStoneAndTheRunBelowIt() {
    var chunk = withStone(3, 9, 40, 47);

    assertThat(chunk.top(3, 9)).hasValue(47);
    assertThat(chunk.depthBelow(3, 47, 9)).isEqualTo(8);
    assertThat(chunk.solid(3, 39, 9)).isFalse();
    assertThat(chunk.volume()).isEqualTo(8);
  }

  @Test
  void aVoidColumnHasNoTop() {
    assertThat(withStone(0, 0, 10, 10).top(1, 0)).isEmpty();
  }

  @Test
  void rejectsCoordinatesOutsideTheChunk() {
    var chunk = withStone(0, 0, 10, 10);

    assertThatThrownBy(() -> chunk.solid(16, 0, 0)).isInstanceOf(IndexOutOfBoundsException.class);
    assertThatThrownBy(() -> chunk.solid(0, SkyTerrain.HEIGHT, 0))
        .isInstanceOf(IndexOutOfBoundsException.class);
  }
}
