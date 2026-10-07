import ca.spottedleaf.dataconverter.minecraft.MCDataConverter;
import ca.spottedleaf.dataconverter.minecraft.datatypes.MCTypeRegistry;
import ca.spottedleaf.dataconverter.minecraft.util.Version;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.mojang.serialization.Dynamic;
import com.mojang.serialization.JsonOps;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.DoubleTag;
import net.minecraft.nbt.FloatTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.NbtOps;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.server.Bootstrap;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.datafix.DataFixers;
import net.minecraft.util.datafix.DataFixTypes;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.saveddata.maps.MapIndex;
import net.minecraft.world.level.saveddata.maps.MapItemSavedData;

/** Converts all historic players, statistics and maps without joining players or ticking a world. */
public final class NativeCompanionConverter {
  private static final Gson JSON = new Gson();
  private static final List<String> EXPERIENCE = List.of("XpP", "XpLevel", "XpTotal");

  private NativeCompanionConverter() {}

  public static void main(String[] arguments) throws IOException {
    SharedConstants.tryDetectVersion();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2")) {
      throw new IllegalStateException("Native conversion requires pinned Paper 26.2");
    }
    Bootstrap.bootStrap();
    if (arguments.length == 1 && arguments[0].equals("--self-test")) {
      selfTest();
      return;
    }
    if (arguments.length != 4) {
      throw new IllegalArgumentException("Expected original world, legacy companion data, native regions and new output");
    }
    var original = Path.of(arguments[0]).toRealPath();
    var source = Path.of(arguments[1]).toRealPath();
    var region = Path.of(arguments[2]).toRealPath();
    var output = Path.of(arguments[3]).toAbsolutePath().normalize();
    if (Files.exists(output)) throw new IllegalArgumentException("Output must be new");
    for (var input : List.of(original, source, region)) {
      if (output.startsWith(input) || input.startsWith(output)) {
        throw new IllegalArgumentException("Output must be independent of every input");
      }
    }
    Files.createDirectory(output);
    var receipts = new LinkedHashMap<String, Object>();
    try (var terrain = new NativeTerrain(region)) {
      if (!terrain.safe(68.5, 69, 66.5)) throw new IllegalStateException("Reviewed safe spawn is no longer safe");
      convertPlayers(original, source, output, terrain, receipts);
    }
    convertStats(source, output, receipts);
    convertMaps(source, output, receipts);
    var receipt = Map.of("schemaVersion", 1, "dataVersion", Version.getCurrentVersion(),
        "files", receipts, "positionValidation", "VERIFIED", "worldTicks", 0,
        "terrainGeneration", false, "currentArenaMapMerge", "PENDING");
    Files.writeString(output.resolve("conversion-receipt.json"), JSON.toJson(receipt) + "\n",
        StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
    System.out.println("Converted native companion data: " + receipts.size() + " files");
  }

  private static List<Path> files(Path directory, String suffix) throws IOException {
    try (var stream = Files.list(directory)) {
      var result = stream.filter(path -> path.getFileName().toString().endsWith(suffix)).sorted().toList();
      for (var path : result) {
        if (Files.isSymbolicLink(path) || !Files.isRegularFile(path)) {
          throw new IllegalArgumentException("Companion input must be regular files");
        }
      }
      return result;
    }
  }

  private static CompoundTag read(Path path) throws IOException {
    if (Files.isSymbolicLink(path) || Files.size(path) > 16 * 1024 * 1024) {
      throw new IllegalArgumentException("Unexpected companion NBT input");
    }
    return NbtIo.readCompressed(path, NbtAccounter.create(16 * 1024 * 1024));
  }

  private static void write(Path path, CompoundTag data) throws IOException {
    NbtIo.writeCompressed(data, path);
    if (!read(path).equals(data)) throw new IllegalStateException("Native companion NBT readback differs");
  }

  private static void convertPlayers(Path original, Path source, Path output, NativeTerrain terrain,
      Map<String, Object> receipts) throws IOException {
    Files.createDirectory(output.resolve("playerdata"));
    for (var file : files(source.resolve("playerdata"), ".dat")) {
      var before = read(file);
      if (NbtUtils.getDataVersion(before, -1) != 4438) {
        throw new IllegalStateException("Player data is outside the legacy checkpoint");
      }
      var historical = read(original.resolve("playerdata").resolve(file.getFileName()));
      var dimension = historical.getInt("Dimension").orElseThrow();
      var after = MCDataConverter.convertTag(MCTypeRegistry.PLAYER, before.copy(),
          4438, Version.getCurrentVersion());
      for (var field : EXPERIENCE) {
        if (!Objects.equals(before.get(field), after.get(field))) {
          throw new IllegalStateException("Native player conversion changed experience");
        }
      }
      for (var field : List.of("Inventory", "EnderItems")) verifyItems(before, after, field);
      verifyEquipment(before, after);
      var position = before.getList("Pos").orElseThrow();
      if (position.size() != 3) throw new IllegalStateException("Invalid player position");
      var reason = dimension != 0 ? "ORIGINAL_DIMENSION_NOT_RESTORED"
          : terrain.safe(position.getDouble(0).orElseThrow(), position.getDouble(1).orElseThrow(),
              position.getDouble(2).orElseThrow()) ? "RETAINED_SAFE_POSITION" : "UNSAFE_OR_ABSENT_TERRAIN";
      if (!reason.equals("RETAINED_SAFE_POSITION")) relocate(after);
      else if (!Objects.equals(before.get("Pos"), after.get("Pos"))) {
        throw new IllegalStateException("Native conversion moved a safe overworld player");
      }
      var bed = validateRespawn(historical, after, terrain);
      // Bind through the native dimension key. Old CraftBukkit world UUIDs and SpawnWorld values
      // identify retired worlds and must never override the verified dimension/respawn metadata.
      for (var obsolete : List.of("WorldUUIDMost", "WorldUUIDLeast", "SpawnWorld")) after.remove(obsolete);
      after.putInt("DataVersion", Version.getCurrentVersion());
      write(output.resolve("playerdata").resolve(file.getFileName()), after);
      receipts.put("playerdata/" + file.getFileName(), Map.of(
          "originalDimension", dimension, "position", reason, "respawn", bed,
          "itemsVerified", true, "experienceUnchanged", true));
    }
  }

  private static void verifyItems(CompoundTag before, CompoundTag after, String field) {
    var input = before.getListOrEmpty(field);
    var output = after.getListOrEmpty(field);
    if (input.size() != output.size()) throw new IllegalStateException("Native conversion changed inventory count");
    for (var i = 0; i < input.size(); i++) {
      var expected = MCDataConverter.convertTag(MCTypeRegistry.ITEM_STACK,
          input.getCompound(i).orElseThrow().copy(), 4438, Version.getCurrentVersion());
      if (!expected.equals(output.getCompound(i).orElseThrow())) {
        throw new IllegalStateException("Native conversion changed complete item metadata");
      }
    }
  }

  private static void verifyEquipment(CompoundTag before, CompoundTag after) {
    var input = before.getCompoundOrEmpty("equipment");
    var output = after.getCompoundOrEmpty("equipment");
    if (!input.keySet().equals(output.keySet())) throw new IllegalStateException("Native equipment slots changed");
    for (var slot : input.keySet()) {
      var expected = MCDataConverter.convertTag(MCTypeRegistry.ITEM_STACK,
          input.getCompound(slot).orElseThrow().copy(), 4438, Version.getCurrentVersion());
      if (!expected.equals(output.getCompound(slot).orElseThrow())) {
        throw new IllegalStateException("Native equipment metadata changed");
      }
    }
  }

  private static void relocate(CompoundTag player) {
    player.putString("Dimension", "minecraft:overworld");
    player.put("Pos", new ListTag(List.of(DoubleTag.valueOf(68.5), DoubleTag.valueOf(69), DoubleTag.valueOf(66.5))));
    player.put("Rotation", new ListTag(List.of(FloatTag.valueOf(-90), FloatTag.valueOf(0))));
    player.put("Motion", new ListTag(List.of(DoubleTag.valueOf(0), DoubleTag.valueOf(0), DoubleTag.valueOf(0))));
    player.putDouble("fall_distance", 0);
    player.remove("FallDistance");
    player.putBoolean("OnGround", true);
    player.remove("RootVehicle");
  }

  private static String validateRespawn(CompoundTag original, CompoundTag player, NativeTerrain terrain)
      throws IOException {
    if (!player.contains("respawn")) return "NONE";
    var respawn = ServerPlayer.RespawnConfig.CODEC.parse(NbtOps.INSTANCE, player.get("respawn"))
        .getOrThrow();
    var data = respawn.respawnData();
    var pos = data.pos();
    var sameWorld = data.dimension().equals(Level.OVERWORLD)
        && (!original.contains("SpawnDimension") || original.getInt("SpawnDimension").orElseThrow() == 0)
        && (!original.contains("SpawnWorld") || original.getString("SpawnWorld").orElseThrow().equals("world"));
    var valid = sameWorld && (respawn.forced()
        ? terrain.safe(pos.getX() + 0.5, pos.getY(), pos.getZ() + 0.5) : terrain.bed(pos));
    if (valid) return respawn.forced() ? "RETAINED_SAFE_FORCED_RESPAWN" : "RETAINED_VALID_BED";
    player.remove("respawn");
    return "CLEARED_UNSAFE_OR_RETIRED_RESPAWN";
  }

  private static void convertStats(Path source, Path output, Map<String, Object> receipts) throws IOException {
    Files.createDirectory(output.resolve("stats"));
    for (var file : files(source.resolve("stats"), ".json")) {
      var before = JSON.fromJson(Files.readString(file), JsonObject.class);
      if (before.get("DataVersion").getAsInt() != 4438) throw new IllegalStateException("Invalid statistics checkpoint");
      var after = DataFixTypes.STATS.updateToCurrentVersion(DataFixers.getDataFixer(),
          new Dynamic<>(JsonOps.INSTANCE, before.deepCopy()), 4438).getValue().getAsJsonObject();
      if (!Objects.equals(before.get("stats"), after.get("stats"))) {
        throw new IllegalStateException("Native statistics conversion changed historic values");
      }
      after.addProperty("DataVersion", Version.getCurrentVersion());
      var target = output.resolve("stats").resolve(file.getFileName());
      Files.writeString(target, JSON.toJson(after) + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
      if (!JSON.fromJson(Files.readString(target), JsonObject.class).equals(after)) {
        throw new IllegalStateException("Native statistics readback differs");
      }
      receipts.put("stats/" + file.getFileName(), Map.of("valuesUnchanged", true));
    }
  }

  private static void convertMaps(Path source, Path output, Map<String, Object> receipts) throws IOException {
    Files.createDirectory(output.resolve("data"));
    for (var file : files(source.resolve("data"), ".dat")) {
      var name = file.getFileName().toString();
      if (!name.matches("map_[0-9]+\\.dat") && !name.equals("idcounts.dat")) {
        throw new IllegalStateException("Unexpected legacy companion map file");
      }
      var before = read(file);
      if (NbtUtils.getDataVersion(before, -1) != 4438) throw new IllegalStateException("Invalid map checkpoint");
      var type = name.equals("idcounts.dat") ? DataFixTypes.SAVED_DATA_MAP_INDEX : DataFixTypes.SAVED_DATA_MAP_DATA;
      var after = type.updateToCurrentVersion(DataFixers.getDataFixer(), before.copy(), 4438);
      if (name.equals("idcounts.dat")) {
        var last = before.getCompound("data").orElseThrow().getInt("map").orElseThrow().intValue();
        var parsed = MapIndex.CODEC.parse(NbtOps.INSTANCE, after.get("data")).getOrThrow();
        if (parsed.getNextMapId().id() != last + 1
            || after.getCompound("data").orElseThrow().getInt("map").orElseThrow() != last) {
          throw new IllegalStateException("Native map counter would overwrite existing maps");
        }
      } else if (!Arrays.equals(
          before.getCompound("data").orElseThrow().getByteArray("colors").orElseThrow(),
          after.getCompound("data").orElseThrow().getByteArray("colors").orElseThrow())) {
        throw new IllegalStateException("Native map conversion changed historic pixels");
      }
      if (!name.equals("idcounts.dat")) {
        var parsed = MapItemSavedData.CODEC.parse(NbtOps.INSTANCE, after.get("data")).getOrThrow();
        if (!Arrays.equals(parsed.colors,
            before.getCompound("data").orElseThrow().getByteArray("colors").orElseThrow())) {
          throw new IllegalStateException("Native map codec would discard historic pixels");
        }
      }
      after.putInt("DataVersion", Version.getCurrentVersion());
      write(output.resolve("data").resolve(file.getFileName()), after);
      receipts.put("data/" + file.getFileName(), Map.of("converted", true));
    }
  }

  private static void selfTest() {
    var counter = new CompoundTag();
    counter.putInt("map", 138);
    if (MapIndex.CODEC.parse(NbtOps.INSTANCE, counter).getOrThrow().getNextMapId().id() != 139) {
      throw new AssertionError("Historic map allocation must continue after the restored IDs");
    }
    // Five-bit palettes exercise padded long storage, including transitions and the last block.
    var palette = new ListTag();
    for (var i = 0; i < 17; i++) {
      var tag = new CompoundTag();
      tag.putString("Name", i == 16 ? "minecraft:stone" : "minecraft:air");
      palette.add(tag);
    }
    var states = new CompoundTag();
    states.put("palette", palette);
    var words = new long[(4096 + 11) / 12];
    for (var index : new int[] {0, 11, 12, 4095}) words[index / 12] |= 16L << ((index % 12) * 5);
    states.putLongArray("data", words);
    for (var index : new int[] {0, 11, 12, 4095}) {
      if (!NativeTerrain.paletteEntry(states, index).getString("Name").orElseThrow().equals("minecraft:stone")) {
        throw new AssertionError("Padded palette decoding failed");
      }
    }
    if (!NativeTerrain.state(NativeTerrain.paletteEntry(states, 1)).isAir()) {
      throw new AssertionError("Air decoding failed");
    }
    var unknown = new CompoundTag();
    unknown.putString("Name", "minecraft:absent_restoration_fixture");
    try {
      NativeTerrain.state(unknown);
      throw new AssertionError("Unknown blocks must fail");
    } catch (IllegalStateException expected) {
      // Registry defaults must not silently turn unknown restored blocks into air.
    }
    var player = new CompoundTag();
    relocate(player);
    if (!player.getString("Dimension").orElseThrow().equals("minecraft:overworld")
        || player.getList("Pos").orElseThrow().getDouble(1).orElseThrow() != 69
        || player.getDouble("fall_distance").orElseThrow() != 0 || player.contains("FallDistance")) {
      throw new AssertionError("Safe-spawn relocation failed");
    }
    System.out.println("Native companion self-tests passed");
  }
}
