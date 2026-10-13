package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import java.util.List;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.MultipleFacing;
import org.bukkit.block.data.type.Ladder;
import org.bukkit.plugin.Plugin;

/** Bounded disposable collision courses; they never replace or repair an imported map. */
final class TraversalArena {
  private static final int ORIGIN = 400;
  private final World world;

  TraversalArena(World world) {
    this.world = world;
  }

  Location at(List<Double> point) {
    return new Location(world, ORIGIN + point.get(0), point.get(1), ORIGIN + point.get(2));
  }

  BlockClassification snapshot() {
    var bounds = new GridBounds(new BlockPos(ORIGIN - 2, 94, ORIGIN - 2), 21, 19, 21);
    var shapes = new BlockShape[bounds.volume()];
    for (var index = 0; index < shapes.length; index++) {
      var cell = bounds.cell(index);
      shapes[index] =
          switch (world.getBlockAt(cell.x(), cell.y(), cell.z()).getType()) {
            case AIR -> BlockShape.PASSABLE;
            case STONE -> BlockShape.FULL;
            case STONE_SLAB -> BlockShape.SLAB_BOTTOM;
            case WATER -> BlockShape.LIQUID;
            case LADDER -> ladderShape(cell);
            case VINE, SCAFFOLDING -> BlockShape.LADDER;
            default ->
                throw new IllegalStateException("unexpected authored traversal block at " + cell);
          };
    }
    return new CourseBlocks(bounds, List.of(shapes));
  }

  private BlockShape ladderShape(BlockPos cell) {
    var data = world.getBlockAt(cell.x(), cell.y(), cell.z()).getBlockData();
    if (!(data instanceof Ladder))
      throw new IllegalStateException("authored ladder has no native Ladder data at " + cell);
    return BlockShape.LADDER;
  }

  private record CourseBlocks(GridBounds bounds, List<BlockShape> shapes)
      implements BlockClassification {
    @Override
    public BlockShape shape(int x, int y, int z) {
      return shapes.get(bounds.index(x, y, z));
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  void tickets(Plugin plugin, boolean retain) {
    for (int x = (ORIGIN - 2) >> 4; x <= (ORIGIN + 18) >> 4; x++)
      for (int z = (ORIGIN - 2) >> 4; z <= (ORIGIN + 18) >> 4; z++) {
        if (retain) world.addPluginChunkTicket(x, z, plugin);
        else world.removePluginChunkTicket(x, z, plugin);
      }
  }

  void prepare(String kind) {
    fill(new BlockPos(-2, 94, -2), new BlockPos(18, 112, 18), Material.AIR);
    fill(new BlockPos(0, 99, 0), new BlockPos(16, 99, 16), Material.STONE);
    switch (kind) {
      case "flat" -> {
        /* The common floor is the complete course. */
      }
      case "step" -> fill(new BlockPos(3, 100, 0), new BlockPos(16, 100, 16), Material.STONE);
      case "diagonal-step" ->
          fill(new BlockPos(3, 100, 3), new BlockPos(16, 100, 16), Material.STONE);
      case "gap-two" -> fill(new BlockPos(3, 99, 0), new BlockPos(4, 99, 16), Material.AIR);
      case "gap-three" -> fill(new BlockPos(3, 99, 0), new BlockPos(5, 99, 16), Material.AIR);
      case "gap-two-up" -> {
        fill(new BlockPos(3, 99, 0), new BlockPos(4, 99, 16), Material.AIR);
        fill(new BlockPos(5, 100, 0), new BlockPos(16, 100, 16), Material.STONE);
      }
      case "gap-three-down" -> {
        fill(new BlockPos(0, 100, 0), new BlockPos(2, 103, 16), Material.STONE);
        fill(new BlockPos(3, 99, 0), new BlockPos(5, 99, 16), Material.AIR);
      }
      case "diagonal-gap" -> {
        fill(new BlockPos(3, 99, 0), new BlockPos(4, 99, 16), Material.AIR);
        fill(new BlockPos(0, 99, 3), new BlockPos(16, 99, 4), Material.AIR);
      }
      case "low-ceiling" ->
          fill(new BlockPos(0, 102, 0), new BlockPos(16, 102, 16), Material.STONE);
      case "slab" -> fill(new BlockPos(3, 100, 0), new BlockPos(5, 100, 16), Material.STONE_SLAB);
      case "ladder", "vine", "scaffolding", "wet-ladder" -> climb(kind);
      default -> wetOrDrop(kind);
    }
  }

  private void wetOrDrop(String kind) {
    switch (kind) {
      case "water" -> water();
      case "water-step" -> waterStep();
      case "water-throat" -> {
        water();
        fill(new BlockPos(4, 98, 0), new BlockPos(4, 102, 16), Material.STONE);
      }
      case "drop-four" -> fill(new BlockPos(0, 100, 0), new BlockPos(2, 103, 16), Material.STONE);
      case "drop-eight" -> fill(new BlockPos(0, 100, 0), new BlockPos(2, 107, 16), Material.STONE);
      case "drop-water" -> {
        water();
        fill(new BlockPos(0, 100, 0), new BlockPos(2, 107, 16), Material.STONE);
        fill(new BlockPos(3, 96, 0), new BlockPos(16, 99, 16), Material.WATER);
      }
      default -> throw new IllegalArgumentException("unknown traversal arena " + kind);
    }
  }

  private void water() {
    fill(new BlockPos(0, 96, 0), new BlockPos(8, 99, 16), Material.WATER);
    fill(new BlockPos(0, 95, 0), new BlockPos(8, 95, 16), Material.STONE);
  }

  private void waterStep() {
    fill(new BlockPos(0, 99, 0), new BlockPos(8, 100, 16), Material.AIR);
    fill(new BlockPos(0, 98, 0), new BlockPos(3, 98, 16), Material.STONE);
    fill(new BlockPos(0, 99, 0), new BlockPos(3, 99, 16), Material.WATER);
    fill(new BlockPos(4, 99, 0), new BlockPos(8, 99, 16), Material.STONE);
    fill(new BlockPos(4, 100, 0), new BlockPos(8, 100, 16), Material.WATER);
  }

  private void climb(String kind) {
    fill(new BlockPos(1, 100, 3), new BlockPos(1, 104, 3), Material.STONE);
    fill(new BlockPos(1, 104, 1), new BlockPos(1, 104, 1), Material.STONE);
    for (var y = 100; y <= 104; y++) {
      var block = world.getBlockAt(ORIGIN + 1, y, ORIGIN + 2);
      switch (kind) {
        case "ladder", "wet-ladder" -> {
          var data = (Ladder) Material.LADDER.createBlockData();
          data.setFacing(BlockFace.NORTH);
          data.setWaterlogged(kind.equals("wet-ladder"));
          block.setBlockData(data, false);
          if (((Ladder) block.getBlockData()).isWaterlogged() != kind.equals("wet-ladder"))
            throw new IllegalStateException("native ladder lost authored waterlogged state");
        }
        case "vine" -> {
          var data = (MultipleFacing) Material.VINE.createBlockData();
          data.setFace(BlockFace.SOUTH, true);
          block.setBlockData(data, false);
        }
        case "scaffolding" -> block.setType(Material.SCAFFOLDING, false);
        default -> throw new IllegalArgumentException("unknown climb course " + kind);
      }
    }
  }

  private void fill(BlockPos low, BlockPos high, Material material) {
    for (var x = low.x(); x <= high.x(); x++)
      for (var y = low.y(); y <= high.y(); y++)
        for (var z = low.z(); z <= high.z(); z++)
          world.getBlockAt(ORIGIN + x, y, ORIGIN + z).setType(material, false);
  }
}
