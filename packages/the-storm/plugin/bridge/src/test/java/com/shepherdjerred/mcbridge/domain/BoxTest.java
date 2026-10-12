package com.shepherdjerred.mcbridge.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class BoxTest {
  @Test
  void normalizesCornersAndMeasures() {
    Box box = Box.of("world", new BlockPos(5, 70, -3), new BlockPos(1, 64, 2));

    assertThat(box.min()).isEqualTo(new BlockPos(1, 64, -3));
    assertThat(box.max()).isEqualTo(new BlockPos(5, 70, 2));
    assertThat(box.size()).isEqualTo(new BlockPos(5, 7, 6));
    assertThat(box.volume()).isEqualTo(210);
  }

  @Test
  void indexesInYzxOrderRelativeToMin() {
    Box box = Box.of("world", new BlockPos(10, 0, 20), new BlockPos(12, 1, 21));

    assertThat(box.index(10, 0, 20)).isZero();
    assertThat(box.index(11, 0, 20)).isEqualTo(1);
    assertThat(box.index(10, 0, 21)).isEqualTo(3);
    assertThat(box.index(10, 1, 20)).isEqualTo(6);
    assertThat(box.index(12, 1, 21)).isEqualTo(11);
  }

  @Test
  void countsChunkColumnsAcrossNegativeCoordinates() {
    Box box = Box.of("world", new BlockPos(-1, 0, -1), new BlockPos(16, 0, 0));

    assertThat(box.chunkColumns()).isEqualTo(3 * 2);
  }

  @Test
  void rejectsOversizedAndOutOfHeightBoxes() {
    Box box = Box.of("world", new BlockPos(0, -70, 0), new BlockPos(99, 10, 99));

    assertThatThrownBy(() -> box.requireVolumeAtMost(1000))
        .isInstanceOfSatisfying(
            BridgeException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.TOO_LARGE));
    assertThatThrownBy(() -> box.requireWithinHeight(-64, 319))
        .isInstanceOfSatisfying(
            BridgeException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.BAD_REQUEST));
  }

  @Test
  void refusesUnnormalizedConstruction() {
    assertThatThrownBy(() -> new Box("world", new BlockPos(1, 0, 0), new BlockPos(0, 0, 0)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
