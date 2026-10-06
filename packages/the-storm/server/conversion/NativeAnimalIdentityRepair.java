import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.chunk.storage.RegionFileStorage;
import net.minecraft.world.level.chunk.storage.RegionStorageInfo;

/** Repairs only repeated unowned historical farm animal identities, on an offline private copy. */
public final class NativeAnimalIdentityRepair {
  private static final Set<String> ANIMALS = Set.of(
      "minecraft:chicken", "minecraft:sheep", "minecraft:pig", "minecraft:cow", "minecraft:mooshroom");

  private NativeAnimalIdentityRepair() {}

  private record Animal(ChunkPos chunk, int index, CompoundTag data) {}

  public static void main(String[] arguments) throws Exception {
    var errors = System.err;
    try {
      SharedConstants.tryDetectVersion();
      if (!SharedConstants.getCurrentVersion().name().equals("26.2")) {
        throw new IllegalStateException("Identity repair requires pinned Paper 26.2");
      }
      Bootstrap.bootStrap();
      if (arguments.length == 1 && arguments[0].equals("self-test")) {
        selfTest();
        return;
      }
      if (arguments.length != 3) throw new IllegalArgumentException("Expected private world, audit and new receipt");
      repair(Path.of(arguments[0]).toRealPath(), Path.of(arguments[1]), Path.of(arguments[2]));
    } catch (Exception failure) {
      failure.printStackTrace(errors);
      throw failure;
    }
  }

  private static void repair(Path world, Path audit, Path output) throws Exception {
    if (Files.exists(output) || output.toAbsolutePath().normalize().startsWith(world)) {
      throw new IllegalArgumentException("Identity receipt must be new and outside the private world");
    }
    var gson = new Gson();
    var report = gson.fromJson(Files.readString(audit), JsonObject.class);
    if (!report.get("status").getAsString().equals("AUDIT_ONLY")
        || report.get("dataVersion").getAsInt() != 4903
        || report.get("terrainGeneration").getAsBoolean() || report.get("worldTicks").getAsLong() != 0) {
      throw new IllegalStateException("Identity repair requires a complete frozen native audit");
    }
    var positions = new HashSet<ChunkPos>();
    var collisions = report.getAsJsonArray("entityUuidCollisions");
    for (var collision : collisions) {
      for (var side : List.of("first", "duplicate")) {
        var at = collision.getAsJsonObject().getAsJsonObject(side);
        if (!at.get("dimension").getAsString().equals("overworld")
            || !at.get("store").getAsString().equals("region")
            || !ANIMALS.contains(at.get("type").getAsString())) {
          throw new IllegalStateException("Review collisions involving retained arenas, owned or other entities");
        }
        positions.add(new ChunkPos(at.get("chunkX").getAsInt(), at.get("chunkZ").getAsInt()));
      }
    }
    var root = world.resolve("dimensions/minecraft/overworld/region");
    var info = new RegionStorageInfo("storm-animal-identity-repair", Level.OVERWORLD, "region");
    var changed = new LinkedHashMap<ChunkPos, CompoundTag>();
    var originalHashes = new LinkedHashMap<ChunkPos, String>();
    var beforeFiles = new LinkedHashMap<String, String>();
    var afterFiles = new LinkedHashMap<String, String>();
    var replacements = 0;
    try (var storage = new RegionFileStorage(info, root, true)) {
      var chunks = new LinkedHashMap<ChunkPos, CompoundTag>();
      var groups = new LinkedHashMap<UUID, List<Animal>>();
      var reserved = new HashSet<UUID>();
      for (var position : positions.stream().sorted(
          Comparator.comparing(NativeAnimalIdentityRepair::regionName)
              .thenComparingInt(at -> (at.z() & 31) * 32 + (at.x() & 31))).toList()) {
        var chunk = storage.read(position);
        if (chunk == null || NbtUtils.getDataVersion(chunk, -1) != 4903) {
          throw new IllegalStateException("Identity audit chunk disappeared or changed native version");
        }
        chunks.put(position, chunk);
        var entities = chunk.getListOrEmpty("entities");
        for (var index = 0; index < entities.size(); index++) {
          var entity = entities.getCompound(index).orElseThrow();
          var identity = uuid(entity.getIntArray("UUID").orElseThrow());
          reserved.add(identity);
          groups.computeIfAbsent(identity, ignored -> new ArrayList<>()).add(new Animal(position, index, entity));
        }
      }
      for (var group : groups.entrySet()) {
        if (group.getValue().size() < 2) continue;
        var kind = group.getValue().getFirst().data().getString("id").orElseThrow();
        for (var animal : group.getValue()) {
          requireUnownedAnimal(animal.data());
          if (!animal.data().getString("id").orElseThrow().equals(kind)) {
            throw new IllegalStateException("Repeated entity identity has conflicting animal types");
          }
        }
        for (var animal : group.getValue().subList(1, group.getValue().size())) {
          var original = chunks.get(animal.chunk());
          var planned = changed.computeIfAbsent(animal.chunk(), ignored -> original.copy());
          var entity = planned.getListOrEmpty("entities").getCompound(animal.index()).orElseThrow();
          var next = UUID.nameUUIDFromBytes(("the-storm:heritage-animal-identity:v1:"
              + group.getKey() + ":" + animal.chunk().x() + ":" + animal.chunk().z() + ":" + animal.index())
              .getBytes(StandardCharsets.UTF_8));
          if (!reserved.add(next)) throw new IllegalStateException("Deterministic replacement identity is already used");
          var before = entity.copy();
          entity.putIntArray("UUID", words(next));
          before.remove("UUID");
          var compared = entity.copy();
          compared.remove("UUID");
          if (!before.equals(compared)) throw new IllegalStateException("Animal repair changed non-identity data");
          replacements++;
        }
      }
      if (replacements != collisions.size()) throw new IllegalStateException("Identity repair differs from the sealed audit");
      var regions = changed.keySet().stream().map(at -> new ChunkPos(at.x() >> 5, at.z() >> 5))
          .collect(java.util.stream.Collectors.toSet());
      for (var region : regions) {
        var name = "r." + region.x() + "." + region.z() + ".mca";
        beforeFiles.put(name, fileHash(root.resolve(name)));
        for (var index = 0; index < 1024; index++) {
          var at = new ChunkPos(region.x() * 32 + (index & 31), region.z() * 32 + (index >> 5));
          var chunk = storage.read(at);
          originalHashes.put(at, chunk == null ? "EMPTY" : hash(chunk));
        }
      }
      for (var entry : changed.entrySet()) {
        if (!chunks.get(entry.getKey()).equals(storage.read(entry.getKey()))) {
          throw new IllegalStateException("Private world changed after identity planning");
        }
        storage.write(entry.getKey(), entry.getValue());
      }
      storage.flush();
      for (var entry : originalHashes.entrySet()) {
        var actual = storage.read(entry.getKey());
        if (changed.containsKey(entry.getKey())) {
          if (!changed.get(entry.getKey()).equals(actual)) throw new IllegalStateException("Repaired chunk readback changed");
        } else if (!entry.getValue().equals(actual == null ? "EMPTY" : hash(actual))) {
          throw new IllegalStateException("Identity repair changed another chunk in the region");
        }
      }
    }
    for (var name : beforeFiles.keySet()) afterFiles.put(name, fileHash(root.resolve(name)));
    Files.writeString(output, gson.toJson(Map.of("schemaVersion", 1, "status", "VERIFIED_ANIMAL_IDENTITIES", "dataVersion", 4903,
        "replacements", replacements, "changedChunks", changed.size(), "beforeFiles", beforeFiles,
        "afterFiles", afterFiles, "onlyDuplicateAnimalUuidChanged", true, "terrainGeneration", false,
        "worldTicks", 0)) + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
  }

  private static void requireUnownedAnimal(CompoundTag entity) {
    if (!ANIMALS.contains(entity.getString("id").orElseThrow())
        || entity.getBoolean("Leashed").orElse(false)
        || Set.of("Passengers", "Riding", "Leash", "leash", "Owner", "OwnerUUID", "OwnerUUIDMost",
            "OwnerUUIDLeast", "owner", "BukkitValues")
            .stream().anyMatch(entity::contains)) {
      throw new IllegalStateException("Review animal ownership, leash, riding or plugin references before identity repair");
    }
  }

  private static String regionName(ChunkPos position) {
    return "r." + (position.x() >> 5) + "." + (position.z() >> 5) + ".mca";
  }

  private static UUID uuid(int[] words) {
    if (words.length != 4) throw new IllegalStateException("Unexpected native entity UUID encoding");
    var bytes = ByteBuffer.allocate(16);
    for (var word : words) bytes.putInt(word);
    return new UUID(bytes.getLong(0), bytes.getLong(8));
  }

  private static int[] words(UUID identity) {
    var bytes = ByteBuffer.allocate(16).putLong(identity.getMostSignificantBits()).putLong(identity.getLeastSignificantBits());
    return new int[] {bytes.getInt(0), bytes.getInt(4), bytes.getInt(8), bytes.getInt(12)};
  }

  private static String hash(CompoundTag tag) throws Exception {
    var digest = MessageDigest.getInstance("SHA-256");
    try (var output = new DataOutputStream(new DigestOutputStream(OutputStream.nullOutputStream(), digest))) {
      NbtIo.write(tag, output);
    }
    return HexFormat.of().formatHex(digest.digest());
  }

  private static String fileHash(Path file) throws Exception {
    var digest = MessageDigest.getInstance("SHA-256");
    try (var input = Files.newInputStream(file)) {
      var buffer = new byte[1024 * 1024];
      for (var count = input.read(buffer); count != -1; count = input.read(buffer)) digest.update(buffer, 0, count);
    }
    return HexFormat.of().formatHex(digest.digest());
  }

  private static void selfTest() throws IOException {
    var identity = UUID.nameUUIDFromBytes("animal-fixture".getBytes(StandardCharsets.UTF_8));
    if (!uuid(words(identity)).equals(identity)) throw new IllegalStateException("Entity identity encoding changed");
    var animal = new CompoundTag();
    animal.putString("id", "minecraft:sheep");
    requireUnownedAnimal(animal);
    for (var key : List.of("OwnerUUID", "Leash", "Passengers", "BukkitValues")) {
      var owned = animal.copy();
      owned.put(key, new CompoundTag());
      expectFailure(() -> requireUnownedAnimal(owned));
    }
    animal.putBoolean("Leashed", true);
    expectFailure(() -> requireUnownedAnimal(animal));
    expectFailure(() -> uuid(new int[] {1, 2}));
  }

  private static void expectFailure(Runnable operation) {
    try { operation.run(); }
    catch (IllegalStateException expected) { return; }
    throw new IllegalStateException("Unsafe identity repair was accepted");
  }
}
