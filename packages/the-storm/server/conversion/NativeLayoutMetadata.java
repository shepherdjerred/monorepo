import com.google.gson.Gson;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.NbtOps;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.saveddata.maps.MapIndex;
import net.minecraft.world.level.storage.LevelData;

/** Prepares a copied legacy level file and verifies the native layout produced by frozen Paper. */
public final class NativeLayoutMetadata {
  /** Reviewed per-archive generator seed, safe spawn and whether historical maps are restored. */
  private record Archive(long seed, int x, int y, int z, int yaw, boolean maps) {}

  // Map 1 spawns at the windmill entrance. Map 2's archived spawn 0,70,9 stands on a top slab,
  // so its reviewed spawn is the adjacent full block one step north.
  private static final Map<String, Archive> ARCHIVES = Map.of(
      "main-map1-2015-07-09", new Archive(-7243611913275695076L, 68, 69, 66, -90, true),
      "main-map2-2016-01-10", new Archive(3544749833371272116L, 0, 70, 8, 0, false));

  private NativeLayoutMetadata() {}

  public static void main(String[] arguments) throws IOException {
    // Paper's bootstrap redirects System.err to its logger, which drops uncaught failure traces.
    var diagnostics = System.err;
    try {
      run(arguments);
    } catch (IOException | RuntimeException failure) {
      failure.printStackTrace(diagnostics);
      diagnostics.flush();
      throw failure;
    }
  }

  private static void run(String[] arguments) throws IOException {
    SharedConstants.tryDetectVersion();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2")) {
      throw new IllegalStateException("Layout verification requires pinned Paper 26.2");
    }
    Bootstrap.bootStrap();
    if (arguments.length != 4) {
      throw new IllegalArgumentException("Expected operation, archive id, source and new output");
    }
    var archive = ARCHIVES.get(arguments[1]);
    if (archive == null) throw new IllegalArgumentException("Unreviewed archive id");
    var source = Path.of(arguments[2]).toRealPath();
    var output = Path.of(arguments[3]).toAbsolutePath().normalize();
    if (Files.exists(output)) throw new IllegalArgumentException("Output must be new");
    switch (arguments[0]) {
      case "prepare" -> prepare(archive, source, output);
      case "verify" -> verify(archive, source, output);
      default -> throw new IllegalArgumentException("Unsupported metadata operation");
    }
  }

  private static void prepare(Archive archive, Path source, Path output) throws IOException {
    var before = NbtIo.readCompressed(source, NbtAccounter.create(16 * 1024 * 1024));
    var data = before.getCompound("Data").orElseThrow();
    if (data.getInt("DataVersion").orElseThrow() != 4438
        || data.getCompound("WorldGenSettings").orElseThrow().getLong("seed").orElseThrow() != archive.seed()
        || data.contains("Player")) {
      throw new IllegalStateException("Unexpected legacy world metadata checkpoint");
    }
    var after = before.copy();
    var copied = after.getCompound("Data").orElseThrow();
    copied.putInt("SpawnX", archive.x());
    copied.putInt("SpawnY", archive.y());
    copied.putInt("SpawnZ", archive.z());
    copied.putFloat("SpawnAngle", archive.yaw());
    NbtIo.writeCompressed(after, output);
    if (!NbtIo.readCompressed(output, NbtAccounter.create(16 * 1024 * 1024)).equals(after)) {
      throw new IllegalStateException("Prepared world metadata readback differs");
    }
  }

  private static void verify(Archive archive, Path world, Path output) throws IOException {
    var level = NbtIo.readCompressed(world.resolve("level.dat"), NbtAccounter.create(16 * 1024 * 1024))
        .getCompound("Data").orElseThrow();
    if (level.getInt("DataVersion").orElseThrow() != 4903) {
      throw new IllegalStateException("Native level metadata has the wrong data version");
    }
    var spawn = LevelData.RespawnData.CODEC.parse(NbtOps.INSTANCE, level.get("spawn")).getOrThrow();
    if (!spawn.dimension().equals(Level.OVERWORLD) || spawn.pos().getX() != archive.x()
        || spawn.pos().getY() != archive.y() || spawn.pos().getZ() != archive.z()
        || spawn.yaw() != archive.yaw()) {
      throw new IllegalStateException("Native world spawn differs from the reviewed safe spawn");
    }
    var dimension = world.resolve("dimensions/minecraft/overworld");
    var generation = NbtIo.readCompressed(dimension.resolve("data/minecraft/world_gen_settings.dat"),
        NbtAccounter.create(16 * 1024 * 1024)).getCompound("data").orElseThrow();
    var generator = generation.getCompound("dimensions").orElseThrow()
        .getCompound("minecraft:overworld").orElseThrow().getCompound("generator").orElseThrow();
    if (generation.getLong("seed").orElseThrow() != archive.seed()
        || !generator.getString("type").orElseThrow().equals("minecraft:noise")
        || !generator.getString("settings").orElseThrow().equals("minecraft:overworld")
        || !generator.getCompound("biome_source").orElseThrow().getString("preset").orElseThrow()
            .equals("minecraft:overworld")) {
      throw new IllegalStateException("Native world generator differs from the historic normal generator");
    }
    var rules = NbtIo.readCompressed(dimension.resolve("data/minecraft/game_rules.dat"),
        NbtAccounter.create(16 * 1024 * 1024)).getCompound("data").orElseThrow();
    if (!rules.getBoolean("minecraft:mob_griefing").orElseThrow()) {
      throw new IllegalStateException("Global mob griefing would disable the requested sheep grazing");
    }
    try (var terrain = new NativeTerrain(dimension.resolve("region"))) {
      if (!terrain.safe(archive.x() + 0.5, archive.y(), archive.z() + 0.5)) {
        throw new IllegalStateException("Native spawn terrain is unsafe");
      }
    }
    var metadata = NbtIo.readCompressed(dimension.resolve("data/paper/metadata.dat"),
        NbtAccounter.create(16 * 1024 * 1024)).getCompound("data").orElseThrow();
    var uuid = metadata.getIntArray("uuid").orElseThrow();
    if (uuid.length != 4) throw new IllegalStateException("Unexpected native world UUID encoding");
    var bytes = ByteBuffer.allocate(16);
    for (var word : uuid) bytes.putInt(word);
    var identity = new java.util.UUID(bytes.getLong(0), bytes.getLong(8));
    var facts = new LinkedHashMap<String, Object>();
    facts.put("schemaVersion", 1);
    facts.put("dataVersion", 4903);
    facts.put("worldUuid", identity.toString());
    facts.put("seed", archive.seed());
    facts.put("generator", "NORMAL");
    facts.put("spawn", Map.of("x", archive.x() + 0.5, "y", archive.y(), "z", archive.z() + 0.5,
        "yaw", archive.yaw(), "pitch", 0));
    facts.put("sheepGrazingPermitted", true);
    if (archive.maps()) facts.put("nextMapId", nextMapId(world));
    facts.put("worldTicks", 0);
    Files.writeString(output, new Gson().toJson(facts) + "\n", StandardCharsets.UTF_8,
        StandardOpenOption.CREATE_NEW);
  }

  private static int nextMapId(Path world) throws IOException {
    var maps = world.resolve("data/minecraft/maps");
    var counter = NbtIo.readCompressed(maps.resolve("last_id.dat"), NbtAccounter.create(16 * 1024 * 1024));
    var lastId = counter.getCompound("data").orElseThrow().getInt("map").orElseThrow();
    var nextId = MapIndex.CODEC.parse(NbtOps.INSTANCE, counter.get("data")).getOrThrow().getNextMapId().id();
    int maximum;
    try (var files = Files.list(maps)) {
      maximum = files.map(path -> path.getFileName().toString())
          .filter(name -> name.matches("[0-9]+\\.dat"))
          .mapToInt(name -> Integer.parseInt(name.substring(0, name.length() - 4))).max().orElseThrow();
    }
    if (nextId != lastId + 1 || nextId <= maximum) {
      throw new IllegalStateException("Native map allocation would overwrite restored maps");
    }
    return nextId;
  }
}
