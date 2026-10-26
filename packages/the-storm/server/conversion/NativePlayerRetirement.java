import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.DoubleTag;
import net.minecraft.nbt.FloatTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;

/** Prepare native player relocations without loading worlds or changing inventories. */
public final class NativePlayerRetirement {
  private static final Set<String> RETIRED = Set.of("minecraft:wilds", "minecraft:peaks");
  private static final Set<String> WORLDS = Set.of(
      "world", "map2", "frontier", "skylands", "world_nether", "world_the_end", "creative");
  private static final Set<String> POSITION_FIELDS = Set.of(
      "Dimension", "Pos", "Rotation", "Motion", "fall_distance", "FallDistance", "OnGround",
      "RootVehicle", "WorldUUIDMost", "WorldUUIDLeast", "SpawnWorld", "respawn");

  private NativePlayerRetirement() {}

  private static ListTag tags(Tag... values) {
    var result = new ListTag();
    for (var value : values) result.add(value);
    return result;
  }

  private static String key(String world) {
    return switch (world) {
      case "world" -> "minecraft:overworld";
      case "world_nether" -> "minecraft:the_nether";
      case "world_the_end" -> "minecraft:the_end";
      default -> "minecraft:" + world;
    };
  }

  private static Map<String, Double> borders(JsonObject policy) {
    if (policy.get("schemaVersion").getAsInt() != 1
        || !policy.get("retired").getAsJsonArray().asList().stream()
            .map(value -> value.getAsString()).collect(java.util.stream.Collectors.toSet())
            .equals(Set.of("wilds", "peaks"))) {
      throw new IllegalArgumentException("Unexpected world retirement policy");
    }
    var result = new LinkedHashMap<String, Double>();
    for (var value : policy.getAsJsonArray("borders")) {
      var border = value.getAsJsonObject();
      var world = border.get("world").getAsString();
      var diameter = border.get("size").getAsDouble();
      if (!WORLDS.contains(world) || !Double.isFinite(diameter) || diameter < 1
          || border.get("centerX").getAsDouble() != 0 || border.get("centerZ").getAsDouble() != 0
          || !border.get("shape").getAsString().equals("circle")
          || result.put(key(world), diameter / 2) != null) {
        throw new IllegalArgumentException("Invalid or repeated retirement border");
      }
    }
    if (result.size() != WORLDS.size()) throw new IllegalArgumentException("Incomplete retained border set");
    return result;
  }

  private static CompoundTag read(Path file) throws IOException {
    if (Files.isSymbolicLink(file) || !Files.isRegularFile(file)) {
      throw new IllegalArgumentException("Player input must be a regular file");
    }
    var tag = NbtIo.readCompressed(file, NbtAccounter.create(64 * 1024 * 1024));
    if (tag.getInt("DataVersion").orElseThrow() != 4903) {
      throw new IllegalArgumentException("Player retirement requires native Paper 26.2 data");
    }
    return tag;
  }

  private static boolean retiredRespawn(Tag value) {
    if (value instanceof StringTag string) return RETIRED.contains(string.value());
    if (value instanceof CompoundTag compound) {
      return compound.keySet().stream().anyMatch(name -> retiredRespawn(compound.get(name)));
    }
    if (value instanceof ListTag list) return list.stream().anyMatch(NativePlayerRetirement::retiredRespawn);
    return false;
  }

  private static boolean pendingDeath(Tag value) {
    if (value instanceof CompoundTag compound) {
      return compound.contains("thestorm:grave_death_handoff")
          || compound.keySet().stream().anyMatch(name -> pendingDeath(compound.get(name)));
    }
    if (value instanceof ListTag list) return list.stream().anyMatch(NativePlayerRetirement::pendingDeath);
    return false;
  }

  private static CompoundTag relocate(CompoundTag before, Map<String, Double> radii) {
    var after = before.copy();
    var world = before.getString("Dimension").orElseThrow();
    var position = before.getList("Pos").orElseThrow();
    if (position.size() != 3) throw new IllegalArgumentException("Invalid player position");
    var x = position.getDouble(0).orElseThrow();
    var z = position.getDouble(2).orElseThrow();
    if (!Double.isFinite(x) || !Double.isFinite(z)) throw new IllegalArgumentException("Nonfinite player position");
    var radius = radii.get(world);
    if (RETIRED.contains(world) || (radius != null && Math.hypot(x, z) > radius)) {
      var creative = world.equals("minecraft:creative");
      after.putString("Dimension", creative ? world : "minecraft:overworld");
      after.put("Pos", tags(
          DoubleTag.valueOf(creative ? -1 : 68.5), DoubleTag.valueOf(creative ? 65 : 69),
          DoubleTag.valueOf(creative ? -1 : 66.5)));
      after.put("Rotation", tags(FloatTag.valueOf(-90), FloatTag.valueOf(0)));
      after.put("Motion", tags(DoubleTag.valueOf(0), DoubleTag.valueOf(0), DoubleTag.valueOf(0)));
      after.putDouble("fall_distance", 0);
      after.remove("FallDistance");
      after.putBoolean("OnGround", true);
      for (var name : List.of("RootVehicle", "WorldUUIDMost", "WorldUUIDLeast", "SpawnWorld")) after.remove(name);
    }
    if (retiredRespawn(after.get("respawn"))) after.remove("respawn");
    var preservedBefore = before.copy();
    var preservedAfter = after.copy();
    for (var name : POSITION_FIELDS) {
      preservedBefore.remove(name);
      preservedAfter.remove(name);
    }
    if (!preservedBefore.equals(preservedAfter)) {
      throw new IllegalStateException("Retirement changed inventory, progression or unrelated player data");
    }
    return after;
  }

  private static String digest(Path file) throws Exception {
    var hash = MessageDigest.getInstance("SHA-256");
    try (var input = Files.newInputStream(file)) {
      var block = new byte[1024 * 1024];
      int length;
      while ((length = input.read(block)) != -1) hash.update(block, 0, length);
    }
    return HexFormat.of().formatHex(hash.digest());
  }

  private static void registry(Path data, Path output, Map<String, String> originals,
      Map<String, String> changed) throws Exception {
    var relative = "plugins/Multiverse-Core/worlds.yml";
    var source = data.resolve(relative);
    if (Files.isSymbolicLink(source) || !Files.isRegularFile(source)) {
      throw new IllegalArgumentException("Multiverse registry must be a regular file");
    }
    var yaml = new Yaml(new SafeConstructor(new LoaderOptions()));
    var document = yaml.load(Files.readString(source));
    if (!(document instanceof Map<?, ?> worlds)) {
      throw new IllegalArgumentException("Multiverse registry lacks its dimension mapping");
    }
    var retained = new LinkedHashMap<>(worlds);
    RETIRED.forEach(retained::remove);
    if (retained.size() != worlds.size() - 2) {
      throw new IllegalArgumentException("Expected exactly the two registered retired dimensions");
    }
    var target = output.resolve(relative);
    Files.createDirectories(target.getParent());
    Files.writeString(target, yaml.dump(retained));
    if (!yaml.load(Files.readString(target)).equals(retained)
        || !yaml.load(Files.readString(source)).equals(worlds)) {
      throw new IllegalStateException("Multiverse registry changed during preparation");
    }
    Files.setPosixFilePermissions(target, Files.getPosixFilePermissions(source));
    originals.put(relative, digest(source));
    changed.put(relative, digest(target));
  }

  public static void main(String[] arguments) throws Exception {
    if (arguments.length != 3) throw new IllegalArgumentException("Expected data root, policy JSON and new output directory");
    var data = Path.of(arguments[0]).toRealPath();
    var policy = JsonParser.parseString(Files.readString(Path.of(arguments[1]))).getAsJsonObject();
    var radii = borders(policy);
    var output = Path.of(arguments[2]).toAbsolutePath().normalize();
    if (Files.exists(output) || output.startsWith(data)) throw new IllegalArgumentException("Player output must be new and independent");
    Files.createDirectories(output);
    var originals = new LinkedHashMap<String, String>();
    var changed = new LinkedHashMap<String, String>();
    var dimensions = new LinkedHashMap<String, Integer>();
    var root = data.resolve("world/players/data");
    if (Files.isSymbolicLink(root) || !Files.isDirectory(root)) throw new IllegalArgumentException("Native player directory is missing");
    try (var paths = Files.list(root)) {
      for (var file : paths.filter(path -> path.getFileName().toString().endsWith(".dat")
          || path.getFileName().toString().endsWith(".dat_old")).sorted().toList()) {
        if (!file.getFileName().toString().matches("[a-f0-9-]{36}\\.dat(?:_old)?")) {
          throw new IllegalArgumentException("Unexpected native player file");
        }
        var before = read(file);
        if (pendingDeath(before)) {
          throw new IllegalStateException("Resolve the saved grave death handoff before retiring worlds: " + file.getFileName());
        }
        dimensions.merge(before.getString("Dimension").orElseThrow(), 1, Integer::sum);
        var after = relocate(before, radii);
        if (before.equals(after)) continue;
        var relative = data.relativize(file).toString();
        originals.put(relative, digest(file));
        var target = output.resolve(relative);
        Files.createDirectories(target.getParent());
        NbtIo.writeCompressed(after, target);
        if (!read(target).equals(after) || !read(file).equals(before)) {
          throw new IllegalStateException("Player preparation changed during readback");
        }
        Files.setPosixFilePermissions(target, Files.getPosixFilePermissions(file));
        changed.put(relative, digest(target));
      }
    }
    var playersRelocated = changed.size();
    registry(data, output, originals, changed);
    var receipt = Map.of("schemaVersion", 1, "originalFiles", originals, "preparedFiles", changed,
        "dimensions", dimensions, "inventoriesPreserved", true, "dataVersion", 4903);
    Files.writeString(output.resolve("receipt.json"), new Gson().toJson(receipt) + "\n");
    System.out.println(new Gson().toJson(Map.of("playersRelocated", playersRelocated, "dimensions", dimensions)));
  }
}
