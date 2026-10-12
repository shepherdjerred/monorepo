import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.BedBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.chunk.storage.RegionFileStorage;
import net.minecraft.world.level.chunk.storage.RegionStorageInfo;

/** Reads existing native chunks only; unsafe or absent terrain never triggers generation. */
public final class NativeTerrain implements AutoCloseable {
  private static final Set<String> HAZARDS = Set.of(
      "magma_block", "cactus", "lava", "fire", "soul_fire", "campfire", "soul_campfire",
      "powder_snow", "sweet_berry_bush", "wither_rose", "end_portal", "nether_portal", "end_gateway");
  private final RegionFileStorage regions;
  private final Map<ChunkPos, Optional<CompoundTag>> chunks = new LinkedHashMap<>();

  public NativeTerrain(Path path) {
    regions = new RegionFileStorage(
        new RegionStorageInfo("storm-restoration", Level.OVERWORLD, "chunk"), path, true);
  }

  public boolean safe(double x, double y, double z) throws IOException {
    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)
        || Math.abs(x) >= 29_999_984 || Math.abs(z) >= 29_999_984 || y < -63 || y >= 318) return false;
    // Check the complete upright player footprint, including chunk boundaries. Partial floors,
    // swimming, flying and uncertain collision arrangements go to the reviewed safe spawn.
    for (var bx = (int) Math.floor(x - 0.3); bx <= (int) Math.floor(x + 0.3); bx++) {
      for (var bz = (int) Math.floor(z - 0.3); bz <= (int) Math.floor(z + 0.3); bz++) {
        var feet = (int) Math.floor(y);
        var ground = block(bx, feet - 1, bz);
        if (ground.isEmpty() || !ground.get().isSolidRender() || hazardous(ground.get())) return false;
        for (var by = feet; by <= (int) Math.floor(y + 1.8); by++) {
          var space = block(bx, by, bz);
          if (space.isEmpty() || !space.get().isAir()) return false;
        }
      }
    }
    return true;
  }

  public boolean bed(BlockPos pos) throws IOException {
    var first = block(pos.getX(), pos.getY(), pos.getZ());
    if (first.isEmpty() || !(first.get().getBlock() instanceof BedBlock)) return false;
    var facing = first.get().getValue(BedBlock.FACING);
    var part = first.get().getValue(BedBlock.PART);
    var direction = part == net.minecraft.world.level.block.state.properties.BedPart.FOOT
        ? facing : facing.getOpposite();
    var otherPos = pos.relative(direction);
    var other = block(otherPos.getX(), otherPos.getY(), otherPos.getZ());
    if (other.isEmpty() || other.get().getBlock() != first.get().getBlock()
        || other.get().getValue(BedBlock.PART) == part
        || other.get().getValue(BedBlock.FACING) != facing) return false;
    for (var center : new BlockPos[] {pos, otherPos}) {
      for (var dx = -1; dx <= 1; dx++) {
        for (var dz = -1; dz <= 1; dz++) {
          if ((dx != 0 || dz != 0)
              && safe(center.getX() + dx + 0.5, center.getY(), center.getZ() + dz + 0.5)) return true;
        }
      }
    }
    return false;
  }

  private static boolean hazardous(BlockState state) {
    return HAZARDS.contains(BuiltInRegistries.BLOCK.getKey(state.getBlock()).getPath());
  }

  private Optional<BlockState> block(int x, int y, int z) throws IOException {
    var pos = new ChunkPos(x >> 4, z >> 4);
    if (!chunks.containsKey(pos)) {
      var chunk = Optional.ofNullable(regions.read(pos));
      if (chunk.isPresent() && (NbtUtils.getDataVersion(chunk.get(), -1) != 4903
          || chunk.get().getInt("xPos").orElseThrow() != pos.x()
          || chunk.get().getInt("zPos").orElseThrow() != pos.z())) {
        throw new IllegalStateException("Terrain is outside the native conversion checkpoint");
      }
      chunks.put(pos, chunk);
      if (chunks.size() > 128) chunks.remove(chunks.keySet().iterator().next());
    }
    var chunk = chunks.get(pos);
    if (chunk.isEmpty()) return Optional.empty();
    var section = chunk.get().getList("sections").orElseThrow().compoundStream()
        .filter(tag -> tag.getByte("Y").orElseThrow() == (y >> 4)).findFirst();
    if (section.isEmpty()) return Optional.empty();
    var states = section.get().getCompound("block_states").orElseThrow();
    return Optional.of(state(paletteEntry(states, (y & 15) * 256 + (z & 15) * 16 + (x & 15))));
  }

  static CompoundTag paletteEntry(CompoundTag states, int index) {
    if (index < 0 || index >= 4096) throw new IllegalArgumentException("Invalid section index");
    var palette = states.getList("palette").orElseThrow();
    if (palette.isEmpty() || palette.size() > 4096) throw new IllegalStateException("Invalid palette size");
    if (palette.size() == 1) return palette.getCompound(0).orElseThrow();
    var bits = Math.max(4, 32 - Integer.numberOfLeadingZeros(palette.size() - 1));
    var perLong = 64 / bits;
    var words = states.getLongArray("data").orElseThrow();
    if (words.length != (4096 + perLong - 1) / perLong) {
      throw new IllegalStateException("Invalid padded block-state storage");
    }
    var selected = (int) ((words[index / perLong] >>> ((index % perLong) * bits)) & ((1L << bits) - 1));
    if (selected >= palette.size()) throw new IllegalStateException("Block palette index is absent");
    return palette.getCompound(selected).orElseThrow();
  }

  static BlockState state(CompoundTag tag) {
    var identifier = Identifier.parse(tag.getString("Name").orElseThrow());
    if (!BuiltInRegistries.BLOCK.containsKey(identifier)) {
      throw new IllegalStateException("Unknown block in restored terrain: " + identifier);
    }
    var block = BuiltInRegistries.BLOCK.getValue(identifier);
    var result = block.defaultBlockState();
    if (tag.contains("Properties")) {
      var properties = tag.getCompound("Properties").orElseThrow();
      for (var key : properties.keySet()) {
        var property = block.getStateDefinition().getProperty(key);
        if (property == null) throw new IllegalStateException("Unknown block-state property");
        result = set(result, property, properties.getString(key).orElseThrow());
      }
    }
    return result;
  }

  private static <T extends Comparable<T>> BlockState set(
      BlockState state, Property<T> property, String value) {
    return state.setValue(property, property.getValue(value).orElseThrow());
  }

  @Override
  public void close() throws IOException {
    regions.close();
  }
}
