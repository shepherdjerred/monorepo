import com.google.gson.Gson;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.HashSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.nbt.Tag;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.chunk.storage.RegionFileStorage;
import net.minecraft.world.level.chunk.storage.RegionStorageInfo;

/** Reads the complete assembled layout without generating chunks, ticking, or changing records. */
public final class NativeActivationCheck {
  private final Set<UUID> entities = new HashSet<>();
  private final Map<UUID, Map<String, Object>> entityLocations = new LinkedHashMap<>();
  private final List<Map<String, Object>> collisions = new ArrayList<>();
  private final Set<UUID> worlds = new HashSet<>();
  private final Set<Integer> maps = new HashSet<>();
  private Path historicalMaps;
  private Path modernMaps;
  private long mapReferences;
  private boolean audit;
  private String dimensionName = "self-test";
  private String storeName = "self-test";
  private ChunkPos chunkPosition = new ChunkPos(0, 0);

  private NativeActivationCheck() {}

  public static void main(String[] arguments) throws IOException {
    var errors = System.err;
    try {
      run(arguments);
    } catch (IOException | RuntimeException failure) {
      failure.printStackTrace(errors);
      throw failure;
    }
  }

  private static void run(String[] arguments) throws IOException {
    SharedConstants.tryDetectVersion();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2")) {
      throw new IllegalStateException("Activation verification requires pinned Paper 26.2");
    }
    Bootstrap.bootStrap();
    if (arguments.length == 1 && arguments[0].equals("self-test")) {
      selfTest();
      return;
    }
    var audit = arguments.length == 4 && arguments[0].equals("audit");
    if (audit) arguments = java.util.Arrays.copyOfRange(arguments, 1, 4);
    if (arguments.length != 3) throw new IllegalArgumentException("Expected world, modern world and new receipt");
    var world = Path.of(arguments[0]).toRealPath();
    var modern = Path.of(arguments[1]).toRealPath();
    var output = Path.of(arguments[2]).toAbsolutePath().normalize();
    if (Files.exists(output) || output.startsWith(world)) {
      throw new IllegalArgumentException("Receipt must be new and outside the world");
    }
    var verifier = new NativeActivationCheck();
    verifier.audit = audit;
    var mapDirectory = world.resolve("data/minecraft/maps");
    verifier.historicalMaps = mapDirectory;
    verifier.modernMaps = modern.resolve("data/minecraft/maps");
    try (var files = Files.list(mapDirectory)) {
      for (var file : files.toList()) {
        var name = file.getFileName().toString();
        if (name.matches("[0-9]+\\.dat")) {
          verifier.maps.add(Integer.parseInt(name.substring(0, name.length() - 4)));
        }
      }
    }
    var dimensions = new LinkedHashMap<String, Object>();
    var root = world.resolve("dimensions/minecraft");
    try (var directories = Files.list(root)) {
      for (var dimension : directories.sorted().toList()) {
        var name = dimension.getFileName().toString();
        verifier.dimensionName = name;
        if (!Set.of("overworld", "the_nether", "the_end", "settlement", "rustworks", "rwf").contains(name)) {
          throw new IllegalStateException("Unexpected dimension in assembled activation layout");
        }
        var metadataPath = dimension.resolve("data/paper/metadata.dat");
        if (!Files.exists(metadataPath) && Set.of("the_nether", "the_end").contains(name)) {
          try (var files = Files.walk(dimension)) {
            var initialFiles = files.filter(Files::isRegularFile).map(dimension::relativize).toList();
            var permitted = name.equals("the_end")
                ? Set.of(Path.of("data/minecraft/ender_dragon_fight.dat"), Path.of("data/minecraft/world_border.dat"))
                : Set.<Path>of();
            if (!permitted.containsAll(initialFiles)) {
              throw new IllegalStateException("Uninitialized vanilla dimension contains unexplained saved data");
            }
          }
          dimensions.put(name, Map.of("initialized", false, "region", 0, "entities", 0, "poi", 0));
          continue;
        }
        var metadata = NbtIo.readCompressed(metadataPath,
            NbtAccounter.create(16 * 1024 * 1024)).getCompound("data").orElseThrow();
        if (!verifier.worlds.add(uuid(metadata.getIntArray("uuid").orElseThrow()))) {
          throw new IllegalStateException("Retained dimensions have colliding world identities");
        }
        var stores = new LinkedHashMap<String, Long>();
        for (var store : List.of("region", "entities", "poi")) {
          stores.put(store, verifier.scan(dimension.resolve(store), store,
              Set.of("settlement", "rustworks", "rwf").contains(name)));
        }
        dimensions.put(name, stores);
        if (name.equals("overworld") && stores.get("region") != 638647L) {
          throw new IllegalStateException("Activation changed the historical terrain chunk inventory");
        }
      }
    }
    if (!dimensions.keySet().containsAll(Set.of("overworld", "settlement", "rustworks", "rwf"))) {
      throw new IllegalStateException("Activation lacks a retained arena dimension");
    }
    try (var players = Files.list(world.resolve("players/data"))) {
      for (var player : players.sorted().toList()) {
        if (!player.getFileName().toString().endsWith(".dat")) {
          throw new IllegalStateException("Unexpected player storage file");
        }
        verifier.checkMaps(NbtIo.readCompressed(player, NbtAccounter.create(64 * 1024 * 1024)), false);
      }
    }
    Files.writeString(output, new Gson().toJson(Map.of("schemaVersion", 1, "dataVersion", 4903,
        "status", audit ? "AUDIT_ONLY" : "VERIFIED",
        "dimensions", dimensions, "uniqueEntities", verifier.entities.size(),
        "uniqueWorlds", verifier.worlds.size(), "mapReferences", verifier.mapReferences,
        "entityUuidCollisions", verifier.collisions, "terrainGeneration", false, "worldTicks", 0)) + "\n",
        StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
  }

  private long scan(Path directory, String store, boolean modern) throws IOException {
    if (!Files.exists(directory)) return 0;
    long count = 0;
    storeName = store;
    var info = new RegionStorageInfo("storm-restoration", Level.OVERWORLD, store);
    try (var storage = new RegionFileStorage(info, directory, true); var files = Files.list(directory)) {
      for (var file : files.sorted().toList()) {
        var name = file.getFileName().toString();
        if (name.matches("c\\.-?\\d+\\.-?\\d+\\.mcc")) continue;
        if (!name.matches("r\\.-?\\d+\\.-?\\d+\\.mca")) {
          throw new IllegalStateException("Unexpected native region storage file");
        }
        var parts = name.split("\\.");
        var rx = Integer.parseInt(parts[1]);
        var rz = Integer.parseInt(parts[2]);
        for (var z = 0; z < 32; z++) {
          for (var x = 0; x < 32; x++) {
            chunkPosition = new ChunkPos(rx * 32 + x, rz * 32 + z);
            var chunk = storage.read(chunkPosition);
            if (chunk == null) continue;
            if (NbtUtils.getDataVersion(chunk, -1) != 4903) {
              throw new IllegalStateException("Activation contains data outside the native checkpoint");
            }
            for (var entity : chunk.getListOrEmpty(store.equals("entities") ? "Entities" : "entities")
                .compoundStream().toList()) {
              checkEntity(entity);
            }
            checkMaps(chunk, modern);
            count++;
          }
        }
      }
    }
    return count;
  }

  private void checkEntity(CompoundTag entity) {
    var identity = uuid(entity.getIntArray("UUID").orElseThrow());
    var data = entity.getCompound("BukkitValues").orElseGet(CompoundTag::new);
    var location = Map.<String, Object>of("dimension", dimensionName, "store", storeName,
        "chunkX", chunkPosition.x(), "chunkZ", chunkPosition.z(),
        "type", entity.getString("id").orElseThrow(), "keys", Set.copyOf(entity.keySet()),
        "pluginKeys", Set.copyOf(data.keySet()));
    if (!entities.add(identity)) {
      if (!audit) throw new IllegalStateException("Activation contains colliding persistent entity UUIDs");
      collisions.add(Map.of("first", entityLocations.get(identity), "duplicate", location));
    } else {
      entityLocations.put(identity, location);
    }
    if (data.contains("thestorm:arena_entity") || data.contains("thestorm:rwf_bomb")
        || data.contains("thestorm:rwf_bot") || entity.getString("id").orElseThrow().equals("minecraft:player")) {
      throw new IllegalStateException("Settle temporary game entities before assembling activation data");
    }
    for (var passenger : entity.getListOrEmpty("Passengers").compoundStream().toList()) checkEntity(passenger);
  }

  private void checkMaps(Tag tag, boolean modern) throws IOException {
    if (tag instanceof CompoundTag compound) {
      if (compound.contains("minecraft:map_id")) {
        if (!maps.contains(compound.getInt("minecraft:map_id").orElseThrow())) {
          throw new IllegalStateException("Retained data references a map missing from the historical map store");
        }
        if (modern) {
          var name = compound.getInt("minecraft:map_id").orElseThrow() + ".dat";
          var current = modernMaps.resolve(name);
          if (!Files.isRegularFile(current) || !NbtIo.readCompressed(current, NbtAccounter.create(16 * 1024 * 1024))
              .equals(NbtIo.readCompressed(historicalMaps.resolve(name), NbtAccounter.create(16 * 1024 * 1024)))) {
            throw new IllegalStateException("Retained arena map needs an explicit map ID merge");
          }
        }
        mapReferences++;
      }
      for (var key : compound.keySet()) checkMaps(compound.get(key), modern);
    } else if (tag instanceof ListTag list) {
      for (var child : list) checkMaps(child, modern);
    }
  }

  private static UUID uuid(int[] words) {
    if (words.length != 4) throw new IllegalStateException("Unexpected native UUID encoding");
    var bytes = ByteBuffer.allocate(16);
    for (var word : words) bytes.putInt(word);
    return new UUID(bytes.getLong(0), bytes.getLong(8));
  }

  private static void selfTest() throws IOException {
    var verifier = new NativeActivationCheck();
    verifier.maps.add(7);
    var entity = new CompoundTag();
    entity.putString("id", "minecraft:armor_stand");
    entity.putIntArray("UUID", new int[] {1, 2, 3, 4});
    verifier.checkEntity(entity);
    expectFailure(() -> verifier.checkEntity(entity));
    var passenger = entity.copy();
    passenger.putIntArray("UUID", new int[] {5, 6, 7, 8});
    var passengers = new ListTag();
    passengers.add(entity);
    passenger.put("Passengers", passengers);
    expectFailure(() -> verifier.checkEntity(passenger));
    var transientEntity = entity.copy();
    transientEntity.putIntArray("UUID", new int[] {9, 10, 11, 12});
    var data = new CompoundTag();
    data.putString("thestorm:arena_entity", "settlement");
    transientEntity.put("BukkitValues", data);
    expectFailure(() -> verifier.checkEntity(transientEntity));
    var components = new CompoundTag();
    components.putInt("minecraft:map_id", 7);
    verifier.checkMaps(components, false);
    components.putInt("minecraft:map_id", 8);
    try {
      verifier.checkMaps(components, false);
      throw new AssertionError("Missing map was accepted");
    } catch (IllegalStateException expected) {
      // Missing maps require an explicit merge, even when the entity itself is valid.
    }
    expectFailure(() -> uuid(new int[] {1, 2}));
    System.out.println("Activation verification self-test passed");
  }

  private static void expectFailure(Runnable operation) {
    try {
      operation.run();
    } catch (IllegalStateException expected) {
      return;
    }
    throw new AssertionError("Invalid native activation data was accepted");
  }
}
