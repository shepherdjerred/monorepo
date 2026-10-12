import java.io.IOException;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.nbt.Tag;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.chunk.storage.RegionFileStorage;
import net.minecraft.world.level.chunk.storage.RegionStorageInfo;

/** Entity and POI records are selected by the same exact columns as arena blocks. */
public final class NativeArenaStorage {
  private NativeArenaStorage() {}

  record Prepared(Map<ChunkPos, CompoundTag> entities, Map<ChunkPos, CompoundTag> poi) {
    Prepared {
      entities = Map.copyOf(entities);
      poi = Map.copyOf(poi);
    }

    Map<String, Object> counts() {
      return Map.of("entityChunks", entities.size(), "poiChunks", poi.size(),
          "entities", entities.values().stream().mapToLong(chunk -> chunk.getListOrEmpty("Entities").size()).sum());
    }

    void apply(Path target) throws IOException {
      for (var name : List.of("entities", "poi")) {
        var rows = name.equals("entities") ? entities : poi;
        try (var storage = new RegionFileStorage(info(name), target.resolve(name), true)) {
          for (var entry : rows.entrySet()) {
            storage.write(entry.getKey(), entry.getValue());
            if (!entry.getValue().equals(storage.read(entry.getKey()))) {
              throw new IllegalStateException("Arena auxiliary readback changed");
            }
          }
          storage.flush();
        }
      }
    }
  }

  static Prepared prepare(Path source, Path target, List<ChunkPos> positions,
      Set<NativeArenaColumns.Column> columns) throws IOException {
    var entityPlans = new LinkedHashMap<ChunkPos, CompoundTag>();
    var poiPlans = new LinkedHashMap<ChunkPos, CompoundTag>();
    for (var name : List.of("entities", "poi")) {
      try (var input = new RegionFileStorage(info(name), source.resolve(name), true);
          var output = new RegionFileStorage(info(name), target.resolve(name), true)) {
        for (var position : positions) {
          var before = output.read(position);
          var current = input.read(position);
          if (before == null && current == null) continue;
          checkVersion(before);
          checkVersion(current);
          if (name.equals("entities")) {
            var expected = new int[] {position.x(), position.z()};
            for (var chunk : java.util.stream.Stream.of(before, current).filter(java.util.Objects::nonNull).toList()) {
              if (!Arrays.equals(chunk.getIntArray("Position").orElseThrow(), expected)) {
                throw new IllegalStateException("Arena entity storage moved a chunk");
              }
            }
            var merged = before == null ? emptyEntities(position) : before.copy();
            merged.put("Entities", NativeArenaColumns.spatial(before == null ? new ListTag() : before.getList("Entities").orElseThrow(),
                current == null ? new ListTag() : current.getList("Entities").orElseThrow(), columns, true));
            entityPlans.put(position, merged);
          } else {
            poiPlans.put(position, mergePoi(before, current, position, columns));
          }
        }
      }
    }
    return new Prepared(entityPlans, poiPlans);
  }

  private static RegionStorageInfo info(String name) {
    return new RegionStorageInfo("storm-restoration", Level.OVERWORLD, name);
  }

  private static void checkVersion(CompoundTag chunk) {
    if (chunk != null && NbtUtils.getDataVersion(chunk, -1) != 4903) {
      throw new IllegalStateException("Arena auxiliary data is outside the native checkpoint");
    }
  }

  private static CompoundTag emptyEntities(ChunkPos position) {
    var chunk = new CompoundTag();
    chunk.putInt("DataVersion", 4903);
    chunk.putIntArray("Position", new int[] {position.x(), position.z()});
    return chunk;
  }

  private static CompoundTag mergePoi(CompoundTag before, CompoundTag current,
      ChunkPos chunk, Set<NativeArenaColumns.Column> columns) {
    var original = before == null ? new CompoundTag() : before.getCompoundOrEmpty("Sections");
    var source = current == null ? new CompoundTag() : current.getCompoundOrEmpty("Sections");
    var sections = new CompoundTag();
    for (var y = -4; y <= 19; y++) {
      var key = Integer.toString(y);
      var records = new ListTag();
      for (var side = 0; side < 2; side++) {
        var found = (side == 0 ? original : source).getCompound(key);
        if (found.isEmpty()) continue;
        if (!found.get().keySet().equals(Set.of("Records", "Valid"))) {
          throw new IllegalStateException("Unreviewed native POI section metadata");
        }
        for (var row : found.get().getList("Records").orElseThrow().compoundStream().toList()) {
          var pos = row.getIntArray("pos").orElseThrow();
          if (pos.length != 3 || (pos[0] >> 4) != chunk.x() || (pos[2] >> 4) != chunk.z()
              || (pos[1] >> 4) != y) throw new IllegalStateException("POI is outside its native chunk section");
          var inside = columns.contains(new NativeArenaColumns.Column(pos[0], pos[2]));
          if (inside == (side == 1)) records.add(row.copy());
        }
      }
      if (!records.isEmpty() || original.contains(key) || source.contains(key)) {
        var section = new CompoundTag();
        section.put("Records", records);
        section.putBoolean("Valid", false);
        sections.put(key, section);
      }
    }
    for (var data : List.of(original, source)) {
      if (data.keySet().stream().anyMatch(key -> !key.matches("-?[0-9]+")
          || Integer.parseInt(key) < -4 || Integer.parseInt(key) > 19)) {
        throw new IllegalStateException("POI metadata is outside native world height");
      }
    }
    var result = before == null ? new CompoundTag() : before.copy();
    result.putInt("DataVersion", 4903);
    result.put("Sections", sections);
    return result;
  }

  static void requireNoMaps(Tag value) {
    if (value instanceof CompoundTag compound) {
      if (compound.contains("minecraft:map_id")) {
        throw new IllegalStateException("Arena references a modern map; explicit map ID rekeying is required before transplant");
      }
      for (var key : compound.keySet()) requireNoMaps(compound.get(key));
    } else if (value instanceof ListTag list) {
      for (var item : list) requireNoMaps(item);
    }
  }
}
