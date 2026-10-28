package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import org.junit.jupiter.api.Test;

final class StargateFrameTest {
  @Test
  void detectsTheDefaultFrameInEitherHorizontalAxis() {
    for (var direction : Direction.HORIZONTAL) {
      var frame = new StargateFrame(new Pos(10, 64, 10), direction);
      var grid = new TestGrid();
      frame.frameBlocks().forEach(pos -> grid.solid(pos, "minecraft:obsidian"));
      assertThat(frame.frameBlocks()).hasSize(10).doesNotHaveDuplicates();
      assertThat(frame.interior()).hasSize(6).doesNotHaveDuplicates();
      assertThat(frame.isClosed(grid)).isTrue();
      grid.solid(frame.interior().getFirst(), "minecraft:stone");
      assertThat(frame.isClosed(grid)).isFalse();
      grid.air(frame.interior().getFirst());
      grid.air(frame.frameBlocks().getFirst());
      assertThat(frame.isClosed(grid)).isFalse();
    }
  }

  @Test
  void rejectsVerticalFramesAndOutOfBoundsCells() {
    assertThatThrownBy(() -> new StargateFrame(new Pos(0, 0, 0), Direction.UP))
        .isInstanceOf(IllegalArgumentException.class);
    var frame = new StargateFrame(new Pos(0, 319, 0), Direction.NORTH);
    var grid = new TestGrid();
    frame.frameBlocks().forEach(pos -> grid.solid(pos, "minecraft:obsidian"));
    assertThat(frame.isClosed(grid)).isFalse();
  }

  @Test
  void findsEitherControlFromTheSignFace() {
    for (var facing : Direction.HORIZONTAL) {
      var frame = new StargateFrame(new Pos(10, 64, 10), facing.clockwise());
      var grid = new TestGrid();
      frame.frameBlocks().forEach(pos -> grid.solid(pos, "minecraft:obsidian"));
      for (var control : frame.controls()) {
        var sign = control.offset(facing);
        assertThat(StargateFrame.find(grid, sign, facing)).contains(frame);
      }
      assertThat(StargateFrame.find(grid, frame.controls().getFirst(), Direction.UP)).isEmpty();
    }
  }
}
