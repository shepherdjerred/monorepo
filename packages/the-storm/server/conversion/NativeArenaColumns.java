import com.google.gson.Gson;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageConfig;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageSite;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.nbt.Tag;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.chunk.storage.RegionFileStorage;
import net.minecraft.world.level.chunk.storage.RegionStorageInfo;

/** Full-height arena columns only. Caller holds stopped-world locks and works on a private copy. */
public final class NativeArenaColumns {
  private static final Set<String> ARENAS = Set.of("settlement", "rustworks");
  private NativeArenaColumns() {}
  record Column(int x, int z) {}
  record BiomeBoundary(int x, int y, int z, int coveredColumns, String historical, String modern) {}

  public static void main(String[] args) throws IOException {
    var errors = System.err;
    try {
      execute(args);
    } catch (IOException | RuntimeException failure) {
      failure.printStackTrace(errors);
      throw failure;
    }
  }

  private static void execute(String[] args) throws IOException {
    SharedConstants.tryDetectVersion();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2")) {
      throw new IllegalStateException("Arena transplant requires pinned Paper 26.2");
    }
    Bootstrap.bootStrap();
    if (args.length == 1 && args[0].equals("self-test")) {
      selfTest();
      System.out.println("Arena column and native palette self-tests passed");
      return;
    }
    if (args.length != 4) throw new IllegalArgumentException("Expected stopped source dimension, private target dimension, heritage config, new receipt");
    var source = Path.of(args[0]).toRealPath();
    var target = Path.of(args[1]).toRealPath();
    var receipt = Path.of(args[3]).toAbsolutePath().normalize();
    if (source.startsWith(target) || target.startsWith(source) || Files.exists(receipt)) {
      throw new IllegalArgumentException("Arena transplant requires independent roots and a new receipt");
    }
    var file = Path.of(args[2]).toRealPath();
    var catalog = StrictYaml.parse(file.toString(), Files.readString(file), HeritageConfig.class)
        .fold(value -> value, errors -> {throw new IllegalArgumentException("Invalid heritage catalog: " + errors);});
    if (!catalog.archiveSha256().equals("89fc7865604b5ab9ecf3030c90a192f8f9c963083cc77135949c953ae6b645fa")) {
      throw new IllegalArgumentException("Arena catalog names another archive");
    }
    var columns = columns(catalog);
    var positions = columns.stream().map(column -> new ChunkPos(column.x() >> 4, column.z() >> 4))
        .distinct().sorted(java.util.Comparator.comparingInt(ChunkPos::x).thenComparingInt(ChunkPos::z)).toList();
    var info = new RegionStorageInfo("storm-restoration", Level.OVERWORLD, "chunk");
    var prepared = new LinkedHashMap<ChunkPos, CompoundTag>();
    var biomeBoundaries = new ArrayList<BiomeBoundary>();
    try (var input = new RegionFileStorage(info, source.resolve("region"), true);
        var output = new RegionFileStorage(info, target.resolve("region"), true)) {
      // The complete plan and all auxiliary records must validate before any target write.
      for (var position : positions) {
        var before = required(output.read(position), position);
        var current = required(input.read(position), position);
        prepared.put(position, merge(before, current, position, columns, biomeBoundaries));
      }
      var auxiliary = NativeArenaStorage.prepare(source, target, positions, columns);
      for (var entry : prepared.entrySet()) {
        output.write(entry.getKey(), entry.getValue());
        if (!entry.getValue().equals(output.read(entry.getKey()))) {
          throw new IllegalStateException("Arena terrain readback changed");
        }
      }
      output.flush();
      auxiliary.apply(target);
      Files.writeString(receipt, new Gson().toJson(Map.of(
          "schemaVersion", 1, "dataVersion", 4903, "arenas", ARENAS, "columns", columns.size(),
          "chunks", positions.size(), "terrainGeneration", false, "worldTicks", 0,
          "auxiliary", auxiliary.counts(), "mapMerge", "NO_REFERENCED_MAPS",
          "biomeBoundary", Map.of("policy", "KEEP_HISTORICAL_PARTIAL_CELLS", "cells", biomeBoundaries))) + "\n",
          StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
    }
  }

  private static Set<Column> columns(HeritageConfig catalog) {
    var columns = new HashSet<Column>();
    var found = new HashSet<String>();
    for (var site : catalog.sites()) {
      if (!ARENAS.contains(site.id())) continue;
      if (!site.world().equals("world") || site.kind() != HeritageSite.Kind.SERVER
          || site.protectedAreas().isEmpty() || !site.protectedChunks().isEmpty()) {
        throw new IllegalArgumentException("Unexpected arena preservation footprint");
      }
      found.add(site.id());
      for (var area : site.protectedAreas()) {
        for (var x = area.from().x(); x <= area.to().x(); x++) {
          for (var z = area.from().z(); z <= area.to().z(); z++) columns.add(new Column(x, z));
        }
      }
    }
    if (!found.equals(ARENAS) || columns.size() != 64018) {
      throw new IllegalArgumentException("Arena footprint differs from the reviewed 64,018 columns");
    }
    // Coordinate hashes cluster on rectangular grids; preserve HashSet's bucket lookup instead
    // of rebuilding this large footprint as an immutable linear-probing set.
    return java.util.Collections.unmodifiableSet(columns);
  }

  private static CompoundTag required(CompoundTag chunk, ChunkPos position) {
    if (chunk == null || NbtUtils.getDataVersion(chunk, -1) != 4903
        || chunk.getInt("xPos").orElseThrow() != position.x()
        || chunk.getInt("zPos").orElseThrow() != position.z()
        || !chunk.getString("Status").orElseThrow().equals("minecraft:full")) {
      throw new IllegalStateException("Arena source and target require existing full native chunks");
    }
    return chunk;
  }

  static CompoundTag merge(CompoundTag before, CompoundTag current, ChunkPos position, Set<Column> columns) {
    return merge(before, current, position, columns, new ArrayList<>());
  }

  private static CompoundTag merge(CompoundTag before, CompoundTag current, ChunkPos position,
      Set<Column> columns, List<BiomeBoundary> biomeBoundaries) {
    var result = before.copy();
    var sections = sections(before);
    var source = sections(current);
    var replaced = new ListTag();
    for (var y = -4; y <= 19; y++) {
      var destination = sections.remove(y);
      var input = source.get(y);
      if (destination == null || input == null) throw new IllegalStateException("Arena column has a missing native section");
      var section = destination.copy();
      section.put("block_states", mergePalette(destination.getCompound("block_states").orElseThrow(),
          input.getCompound("block_states").orElseThrow(), position, columns, false));
      section.put("biomes", mergePalette(destination.getCompound("biomes").orElseThrow(),
          input.getCompound("biomes").orElseThrow(), position, columns, true, y, biomeBoundaries));
      section.remove("BlockLight");
      section.remove("SkyLight");
      replaced.add(section);
    }
    for (var section : sections.values()) {
      if (section.contains("block_states") || section.contains("biomes")) {
        throw new IllegalStateException("Arena section extends beyond the reviewed native height");
      }
      var lighting = section.copy();
      lighting.remove("BlockLight");
      lighting.remove("SkyLight");
      replaced.add(lighting);
    }
    result.put("sections", replaced);
    for (var key : List.of("block_entities", "block_ticks", "fluid_ticks")) {
      result.put(key, spatial(before.getListOrEmpty(key), current.getListOrEmpty(key), columns, false));
    }
    result.put("entities", spatial(before.getListOrEmpty("entities"), current.getListOrEmpty("entities"), columns, true));
    // Quart biomes cannot split a 4x4 cell. Partial cells keep the historical biome, with each
    // differing cell reported; block, entity and POI selection still uses exact arena columns.
    mergePostProcessing(before, current, result, position, columns);
    var full = true;
    for (var x = 0; x < 16; x++) for (var z = 0; z < 16; z++) {
      full &= columns.contains(new Column(position.x() * 16 + x, position.z() * 16 + z));
    }
    if (full) {
      result.remove("ChunkBukkitValues");
      if (current.contains("ChunkBukkitValues")) result.put("ChunkBukkitValues", current.get("ChunkBukkitValues").copy());
    } else if (current.contains("ChunkBukkitValues")
        && !current.getCompound("ChunkBukkitValues").orElseThrow().isEmpty()) {
      throw new IllegalStateException("Partial arena chunk has unreviewed chunk-wide metadata");
    }
    result.remove("Heightmaps");
    result.putBoolean("isLightOn", false);
    return result;
  }

  private static Map<Integer, CompoundTag> sections(CompoundTag chunk) {
    var result = new java.util.TreeMap<Integer, CompoundTag>();
    for (var tag : chunk.getList("sections").orElseThrow().compoundStream().toList()) {
      if (result.put((int) tag.getByte("Y").orElseThrow(), tag) != null) {
        throw new IllegalStateException("Duplicate native chunk section");
      }
    }
    return result;
  }

  private static CompoundTag mergePalette(CompoundTag before, CompoundTag current,
      ChunkPos chunk, Set<Column> columns, boolean biome) {
    return mergePalette(before, current, chunk, columns, biome, 0, new ArrayList<>());
  }

  private static CompoundTag mergePalette(CompoundTag before, CompoundTag current,
      ChunkPos chunk, Set<Column> columns, boolean biome, int sectionY, List<BiomeBoundary> boundaries) {
    var count = biome ? 64 : 4096;
    var bits = biome ? 1 : 4;
    var values = NativePalettes.decode(before, count, bits);
    var source = NativePalettes.decode(current, count, bits);
    for (var index = 0; index < count; index++) {
      var x = biome ? (index & 3) * 4 : index & 15;
      var z = biome ? ((index >> 2) & 3) * 4 : (index >> 4) & 15;
      var covered = 0;
      var size = biome ? 4 : 1;
      for (var dx = 0; dx < size; dx++) for (var dz = 0; dz < size; dz++) {
        if (columns.contains(new Column(chunk.x() * 16 + x + dx, chunk.z() * 16 + z + dz))) covered++;
      }
      if (covered == size * size) values.set(index, source.get(index));
      else if (covered > 0 && !values.get(index).equals(source.get(index))) {
        boundaries.add(new BiomeBoundary(chunk.x() * 16 + x, sectionY * 16 + ((index >> 4) & 3) * 4,
            chunk.z() * 16 + z, covered, values.get(index).toString(), source.get(index).toString()));
      }
    }
    return NativePalettes.encode(values, bits);
  }

  static ListTag spatial(ListTag before, ListTag current, Set<Column> columns, boolean entity) {
    var result = new ListTag();
    for (var row : before.compoundStream().toList()) if (!inside(row, columns, entity)) result.add(row.copy());
    for (var row : current.compoundStream().toList()) if (inside(row, columns, entity)) {
      NativeArenaStorage.requireNoMaps(row);
      result.add(row.copy());
    }
    if (before.compoundStream().count() != before.size() || current.compoundStream().count() != current.size()) {
      throw new IllegalStateException("Non-compound arena spatial record");
    }
    return result;
  }

  static boolean inside(CompoundTag row, Set<Column> columns, boolean entity) {
    if (entity) {
      var pos = row.getList("Pos").orElseThrow();
      if (pos.size() != 3) throw new IllegalStateException("Invalid arena entity position");
      var x = pos.getDouble(0).orElseThrow();
      var z = pos.getDouble(2).orElseThrow();
      if (!Double.isFinite(x) || !Double.isFinite(z)) throw new IllegalStateException("Non-finite arena entity position");
      return columns.contains(new Column((int) Math.floor(x), (int) Math.floor(z)));
    }
    return columns.contains(new Column(row.getInt("x").orElseThrow(), row.getInt("z").orElseThrow()));
  }

  private static void mergePostProcessing(CompoundTag before, CompoundTag current, CompoundTag result,
      ChunkPos chunk, Set<Column> columns) {
    var original = before.getListOrEmpty("PostProcessing");
    var source = current.getListOrEmpty("PostProcessing");
    if ((!original.isEmpty() && original.size() != 24) || (!source.isEmpty() && source.size() != 24)) {
      throw new IllegalStateException("Unexpected native postprocessing height");
    }
    var merged = new ListTag();
    for (var index = 0; index < 24; index++) {
      var values = new ListTag();
      for (var side = 0; side < 2; side++) {
        var rows = side == 0 ? original : source;
        if (rows.isEmpty()) continue;
        var list = rows.getList(index).orElseThrow();
        for (var packed : list) {
          if (!(packed instanceof net.minecraft.nbt.ShortTag tag)) throw new IllegalStateException("Invalid postprocessing position");
          var value = tag.shortValue();
          var inside = columns.contains(new Column(chunk.x() * 16 + (value & 15), chunk.z() * 16 + ((value >> 8) & 15)));
          if (inside == (side == 1)) values.add(packed.copy());
        }
      }
      merged.add(values);
    }
    result.put("PostProcessing", merged);
  }

  private static void selfTest() {
    var original = new CompoundTag();
    original.putString("Name", "minecraft:stone");
    var replacement = new CompoundTag();
    replacement.putString("Name", "minecraft:oak_planks");
    var before = new ArrayList<Tag>(java.util.Collections.nCopies(4096, original));
    var current = new ArrayList<Tag>(java.util.Collections.nCopies(4096, replacement));
    var columns = Set.of(new Column(-1, -1));
    var merged = NativePalettes.decode(mergePalette(NativePalettes.encode(before, 4),
        NativePalettes.encode(current, 4), new ChunkPos(-1, -1), columns, false), 4096, 4);
    for (var index = 0; index < 4096; index++) {
      var expected = (index & 255) == 255 ? replacement : original;
      if (!merged.get(index).equals(expected)) throw new IllegalStateException("Column boundary self-test failed");
    }
    var originalBiomes = new ArrayList<Tag>(java.util.Collections.nCopies(64,
        net.minecraft.nbt.StringTag.valueOf("minecraft:plains")));
    var modernBiomes = new ArrayList<Tag>(java.util.Collections.nCopies(64,
        net.minecraft.nbt.StringTag.valueOf("minecraft:desert")));
    var biomeColumns = new HashSet<>(columns);
    for (var x = -16; x < -12; x++) for (var z = -16; z < -12; z++) {
      biomeColumns.add(new Column(x, z));
    }
    var boundaries = new ArrayList<BiomeBoundary>();
    var biomes = NativePalettes.decode(mergePalette(NativePalettes.encode(originalBiomes, 1),
        NativePalettes.encode(modernBiomes, 1), new ChunkPos(-1, -1), biomeColumns, true, -4, boundaries), 64, 1);
    for (var index = 0; index < 64; index++) {
      var expected = (index & 15) == 0 ? modernBiomes.get(index) : originalBiomes.get(index);
      if (!biomes.get(index).equals(expected)) throw new IllegalStateException("Biome boundary preservation failed");
    }
    if (boundaries.size() != 4 || boundaries.stream().anyMatch(cell -> cell.x() != -4 || cell.z() != -4
        || cell.coveredColumns() != 1 || cell.y() < -64 || cell.y() > -52
        || !cell.historical().equals(originalBiomes.getFirst().toString())
        || !cell.modern().equals(modernBiomes.getFirst().toString()))) {
      throw new IllegalStateException("Biome boundary receipt failed");
    }
    for (var count : List.of(1, 2, 17, 33, 257, 513, 4096)) {
      var values = new ArrayList<Tag>();
      for (var index = 0; index < 4096; index++) {
        var tag = new CompoundTag(); tag.putInt("fixture", index % count); values.add(tag);
      }
      if (!values.equals(NativePalettes.decode(NativePalettes.encode(values, 4), 4096, 4))) {
        throw new IllegalStateException("Padded palette self-test failed");
      }
    }
  }
}
