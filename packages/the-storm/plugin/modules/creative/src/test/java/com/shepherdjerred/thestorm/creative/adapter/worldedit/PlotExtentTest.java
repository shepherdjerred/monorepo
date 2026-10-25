package com.shepherdjerred.thestorm.creative.adapter.worldedit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.creative.domain.PlotArea;
import com.shepherdjerred.thestorm.creative.domain.PlotBounds;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.PlotMerge;
import com.sk89q.worldedit.WorldEditException;
import com.sk89q.worldedit.extent.NullExtent;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.registry.state.Property;
import com.sk89q.worldedit.world.block.BaseBlock;
import com.sk89q.worldedit.world.block.BlockState;
import com.sk89q.worldedit.world.block.BlockStateHolder;
import com.sk89q.worldedit.world.block.BlockType;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

final class PlotExtentTest {

  private static final Holder STONE = new Holder("minecraft:stone");
  private static final Holder COMMAND = new Holder("minecraft:command_block");

  private final PlotBounds plot = new PlotBounds(new PlotId(1, -2), 5, 86, -271, -190);

  @Test
  @DisplayName("one block onto the road writes nothing")
  void oneBlockOntoTheRoadWritesNothing() throws WorldEditException {
    var inner = new RecordingExtent();
    var extent = extent(inner);
    var inside = BlockVector3.at(45, 64, -231);
    var road = BlockVector3.at(87, 64, -231);

    extent.setBlock(inside, STONE);

    assertThatThrownBy(() -> extent.setBlock(road, STONE)).isInstanceOf(RefusedEdit.class);
    extent.commit();

    assertThat(inner.writes).as("one-block-onto-the-road refusal").isEmpty();
  }

  @Test
  @DisplayName("a command block paste writes nothing")
  void aCommandBlockPasteWritesNothing() throws WorldEditException {
    var inner = new RecordingExtent();
    var extent = extent(inner);
    var inside = BlockVector3.at(45, 64, -231);

    extent.setBlock(inside, STONE);

    assertThatThrownBy(() -> extent.setBlock(inside, COMMAND)).isInstanceOf(RefusedEdit.class);
    extent.commit();

    assertThat(inner.writes).isEmpty();
  }

  @Test
  void anEditInsideThePlotIsAppliedOnCommit() throws WorldEditException {
    var inner = new RecordingExtent();
    var extent = extent(inner);
    var first = BlockVector3.at(45, 64, -231);
    var second = BlockVector3.at(46, 64, -231);

    extent.setBlock(first, STONE);
    extent.setBlock(second, STONE);
    extent.commit();

    assertThat(inner.writes).containsExactly(first, second);
  }

  @Test
  @DisplayName("an empty flush does not drop the later edit")
  void anEmptyFlushDoesNotDropTheLaterEdit() throws WorldEditException {
    var inner = new RecordingExtent();
    var extent = extent(inner);
    var inside = BlockVector3.at(45, 64, -231);

    extent.commit();
    extent.setBlock(inside, STONE);
    extent.commit();

    assertThat(inner.writes).containsExactly(inside);
  }

  @Test
  @DisplayName("a merged road stays inside the edit")
  void aMergedRoadStaysInsideTheEdit() throws WorldEditException {
    var grid = PlotGrid.recovered();
    var east = new PlotId(1, 1);
    var further = new PlotId(2, 1);
    var inner = new RecordingExtent();
    var extent =
        new PlotExtent(
            inner,
            new PlotExtent.Column(PlotMerge.areas(grid, List.of(east, further)), -64, 319),
            () -> {});
    var road = BlockVector3.at(87, 64, 45);
    var outside = BlockVector3.at(4, 64, 45);

    extent.setBlock(road, STONE);
    extent.commit();

    assertThat(inner.writes).containsExactly(road);
    assertThatThrownBy(() -> extent.setBlock(outside, STONE)).isInstanceOf(RefusedEdit.class);
  }

  private PlotExtent extent(RecordingExtent inner) {
    return new PlotExtent(
        inner, new PlotExtent.Column(List.of(PlotArea.of(plot)), -64, 319), () -> {});
  }

  /** A block id only. WorldEdit's real states need a platform this test does not start. */
  private static final class Holder implements BlockStateHolder<Holder> {

    private final BlockType type;

    private Holder(String id) {
      this.type = new BlockType(id);
    }

    @Override
    public BlockType getBlockType() {
      return type;
    }

    @Override
    public <V> Holder with(Property<V> property, V value) {
      throw unused(property, value);
    }

    @Override
    public <V> V getState(Property<V> property) {
      throw unused(property);
    }

    @Override
    public Map<Property<?>, Object> getStates() {
      throw unused();
    }

    @Override
    public boolean equalsFuzzy(BlockStateHolder<?> other) {
      throw unused(other);
    }

    @Override
    public BlockState toImmutableState() {
      throw unused();
    }

    @Override
    public BaseBlock toBaseBlock() {
      throw unused();
    }

    private static UnsupportedOperationException unused(Object... ignored) {
      return new UnsupportedOperationException(String.valueOf(ignored.length));
    }
  }

  /** Records positions that actually reach the world. */
  private static final class RecordingExtent extends NullExtent {

    private final List<BlockVector3> writes = new ArrayList<>();

    @Override
    public <T extends BlockStateHolder<T>> boolean setBlock(BlockVector3 position, T block) {
      writes.add(position);
      return true;
    }
  }
}
