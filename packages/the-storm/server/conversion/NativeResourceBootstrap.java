import com.google.gson.Gson;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.server.Bootstrap;

/** Creates fresh resource dimension identities and metadata, without loading or ticking worlds. */
public final class NativeResourceBootstrap {
  private NativeResourceBootstrap() {}

  private static CompoundTag read(Path path) throws IOException {
    var tag = NbtIo.readCompressed(path, NbtAccounter.create(16 * 1024 * 1024));
    if (tag.getInt("DataVersion").orElseThrow() != 4903) {
      throw new IllegalStateException("Resource metadata requires native data version 4903");
    }
    return tag;
  }

  private static void write(Path path, CompoundTag tag) throws IOException {
    Files.createDirectories(path.getParent());
    NbtIo.writeCompressed(tag, path);
    if (!read(path).equals(tag)) throw new IllegalStateException("Resource metadata readback differs");
  }

  public static void main(String[] arguments) throws IOException {
    SharedConstants.tryDetectVersion();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2") || arguments.length != 3) {
      throw new IllegalArgumentException("Expected pinned Paper 26.2, source world, new output and request UUID");
    }
    Bootstrap.bootStrap();
    var source = Path.of(arguments[0]).toRealPath();
    var output = Path.of(arguments[1]).toAbsolutePath().normalize();
    var request = UUID.fromString(arguments[2]);
    if (!request.toString().equals(arguments[2]) || Files.exists(output)) {
      throw new IllegalArgumentException("Output must be new and request canonical");
    }
    var identities = new HashSet<UUID>();
    try (var paths = Files.list(source.resolve("dimensions/minecraft"))) {
      for (var dimension : paths.toList()) {
        var words = read(dimension.resolve("data/paper/metadata.dat"))
            .getCompound("data").orElseThrow().getIntArray("uuid").orElseThrow();
        if (words.length != 4) throw new IllegalStateException("Invalid dimension UUID");
        var identity = new UUID(((long) words[0] << 32) | (words[1] & 0xffffffffL),
            ((long) words[2] << 32) | (words[3] & 0xffffffffL));
        if (!identities.add(identity)) throw new IllegalStateException("Duplicate source dimension UUID");
      }
    }
    var dimensions = new LinkedHashMap<String, Object>();
    for (var name : new String[] {"wilds", "peaks", "mining"}) {
      var preset = switch (name) {
        case "wilds" -> "minecraft:large_biomes";
        case "peaks" -> "minecraft:amplified";
        default -> "minecraft:overworld";
      };
      var root = source.resolve("dimensions/minecraft/" + name);
      var generation = read(root.resolve("data/minecraft/world_gen_settings.dat"));
      var settings = generation.getCompound("data").orElseThrow();
      var generator = settings.getCompound("dimensions").orElseThrow()
          .getCompound("minecraft:overworld").orElseThrow().getCompound("generator").orElseThrow();
      if (!generator.getString("settings").orElseThrow().equals(preset)
          || !generator.getString("type").orElseThrow().equals("minecraft:noise")
          || !generator.getCompound("biome_source").orElseThrow().getString("preset").orElseThrow()
              .equals("minecraft:overworld")) {
        throw new IllegalStateException("Resource generator differs from declared preset: " + name);
      }
      var identity = UUID.nameUUIDFromBytes((request + ":fresh-resource:" + name).getBytes(StandardCharsets.UTF_8));
      if (!identities.add(identity)) throw new IllegalStateException("Fresh resource UUID collision");
      var metadata = new CompoundTag();
      metadata.putInt("DataVersion", 4903);
      var data = new CompoundTag();
      data.putIntArray("uuid", new int[] {(int) (identity.getMostSignificantBits() >> 32),
          (int) identity.getMostSignificantBits(), (int) (identity.getLeastSignificantBits() >> 32),
          (int) identity.getLeastSignificantBits()});
      metadata.put("data", data);
      var overrides = read(root.resolve("data/paper/level_overrides.dat")).copy();
      overrides.getCompound("data").orElseThrow().putLong("game_time", 0L);
      overrides.getCompound("data").orElseThrow().putBoolean("initialized", false);
      var destination = output.resolve("world/dimensions/minecraft/" + name);
      write(destination.resolve("data/paper/metadata.dat"), metadata);
      write(destination.resolve("data/paper/level_overrides.dat"), overrides);
      write(destination.resolve("data/minecraft/world_gen_settings.dat"), generation);
      dimensions.put(name, Map.of("uuid", identity.toString(), "preset", preset,
          "seed", settings.getLong("seed").orElseThrow(), "terrainChunks", 0));
    }
    var receipt = Map.of("status", "VERIFIED", "requestId", request.toString(), "dataVersion", 4903,
        "worldTicks", 0, "terrainGeneration", false, "dimensions", dimensions);
    Files.writeString(output.resolve("native-receipt.json"), new Gson().toJson(receipt) + "\n",
        StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
  }
}
