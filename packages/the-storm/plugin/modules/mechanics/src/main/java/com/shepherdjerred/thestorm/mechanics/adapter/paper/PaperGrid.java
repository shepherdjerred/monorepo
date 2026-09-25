package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mobility;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mount;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Shape;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.TileState;
import org.bukkit.block.data.Directional;
import org.bukkit.block.data.Rotatable;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Entity;

/** One world, seen as the domain's {@link BlockGrid}. Reads live blocks; main thread only. */
final class PaperGrid implements BlockGrid {

  /** Blocks that hurt whoever stands in or on them. */
  private static final Set<Material> HAZARDS =
      Set.of(
          Material.LAVA,
          Material.FIRE,
          Material.SOUL_FIRE,
          Material.MAGMA_BLOCK,
          Material.CAMPFIRE,
          Material.SOUL_CAMPFIRE,
          Material.CACTUS,
          Material.SWEET_BERRY_BUSH,
          Material.WITHER_ROSE,
          Material.POWDER_SNOW,
          Material.POINTED_DRIPSTONE);

  private final World world;

  PaperGrid(World world) {
    this.world = world;
  }

  World world() {
    return world;
  }

  Block block(Pos pos) {
    return world.getBlockAt(pos.x(), pos.y(), pos.z());
  }

  static Pos pos(Block block) {
    return new Pos(block.getX(), block.getY(), block.getZ());
  }

  static Pos pos(Location location) {
    return new Pos(location.getBlockX(), location.getBlockY(), location.getBlockZ());
  }

  /** The block an entity's feet are in. */
  static Pos feet(Entity entity) {
    return new Pos(
        (int) Math.floor(entity.getX()),
        (int) Math.floor(entity.getY()),
        (int) Math.floor(entity.getZ()));
  }

  /** Where an entity stands, facing where it faces. */
  static Location at(Entity entity) {
    return new Location(
        entity.getWorld(),
        entity.getX(),
        entity.getY(),
        entity.getZ(),
        entity.getYaw(),
        entity.getPitch());
  }

  Location location(Pos pos) {
    return new Location(world, pos.x(), pos.y(), pos.z());
  }

  @Override
  public Cell cellAt(Pos pos) {
    return cell(block(pos));
  }

  @Override
  public Optional<SignView> signAt(Pos pos) {
    var block = block(pos);
    return Signs.isSign(block.getType()) && block.getState(false) instanceof Sign sign
        ? Optional.of(view(block, frontLines(sign)))
        : Optional.empty();
  }

  @Override
  public int minY() {
    return world.getMinHeight();
  }

  @Override
  public int maxY() {
    return world.getMaxHeight();
  }

  static String key(Material material) {
    return material.getKey().toString();
  }

  static Cell cell(Block block) {
    var type = block.getType();
    var fixed = block.getState(false) instanceof TileState || type.getHardness() < 0;
    return new Cell(key(type), shape(block), mobility(block), fixed);
  }

  private static Shape shape(Block block) {
    var type = block.getType();
    if (type.isAir()) {
      return Shape.EMPTY;
    }
    if (HAZARDS.contains(type)) {
      return Shape.HAZARD;
    }
    if (block.isLiquid()) {
      return Shape.LIQUID;
    }
    return block.isPassable() ? Shape.PASSABLE : Shape.SOLID;
  }

  private static Mobility mobility(Block block) {
    return switch (block.getPistonMoveReaction()) {
      case MOVE -> Mobility.NORMAL;
      case BREAK -> Mobility.BREAK;
      case BLOCK -> Mobility.BLOCK;
      case PUSH_ONLY -> Mobility.PUSH_ONLY;
      case IGNORE -> Mobility.IGNORE;
    };
  }

  /** The front text of {@code sign} as plain strings. */
  static List<String> frontLines(Sign sign) {
    return sign.getSide(Side.FRONT).lines().stream().map(PaperGrid::plain).toList();
  }

  static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  /** The sign at {@code block} as it would read with {@code lines} on its front. */
  static SignView view(Block block, List<String> lines) {
    var data = block.getBlockData();
    if (data instanceof WallSign wall) {
      return new SignView(lines, Mount.WALL, compass(wall.getFacing()));
    }
    var mount = Signs.isHanging(block.getType()) ? Mount.HANGING : Mount.STANDING;
    if (data instanceof Rotatable rotatable) {
      return new SignView(lines, mount, compass(rotatable.getRotation()));
    }
    if (data instanceof Directional directional) {
      return new SignView(lines, mount, compass(directional.getFacing()));
    }
    throw new IllegalStateException("a sign block without a direction: " + data);
  }

  /** The block face as one of the six directions; empty for diagonals and SELF. */
  static Optional<Direction> direction(BlockFace face) {
    return Arrays.stream(Direction.values())
        .filter(direction -> face(direction) == face)
        .findFirst();
  }

  /** The compass direction a sign faces; empty for UP, DOWN and diagonals. */
  static Optional<Direction> compass(BlockFace face) {
    return direction(face).filter(Direction::isHorizontal);
  }

  static BlockFace face(Direction direction) {
    return switch (direction) {
      case NORTH -> BlockFace.NORTH;
      case EAST -> BlockFace.EAST;
      case SOUTH -> BlockFace.SOUTH;
      case WEST -> BlockFace.WEST;
      case UP -> BlockFace.UP;
      case DOWN -> BlockFace.DOWN;
    };
  }
}
