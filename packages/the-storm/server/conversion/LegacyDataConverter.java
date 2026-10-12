import ca.spottedleaf.dataconverter.minecraft.MCDataConverter;
import ca.spottedleaf.dataconverter.minecraft.datatypes.MCTypeRegistry;
import ca.spottedleaf.dataconverter.minecraft.util.Version;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.mojang.serialization.Dynamic;
import com.mojang.serialization.JsonOps;
import java.io.IOException;
import java.io.DataInputStream;
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
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.util.datafix.DataFixers;
import net.minecraft.util.datafix.DataFixTypes;

/** Offline archive companion-data conversion using the exact pinned Paper server's converter. */
public final class LegacyDataConverter {
  private static final Gson JSON = new Gson();
  private static final List<String> EXPERIENCE = List.of("XpP", "XpLevel", "XpTotal");

  private LegacyDataConverter() {}

  public static void main(String[] arguments) throws IOException {
    if (arguments.length != 2) throw new IllegalArgumentException("Expected source world and new output");
    SharedConstants.tryDetectVersion();
    if (!SharedConstants.getCurrentVersion().name().equals("1.21.7")) {
      throw new IllegalStateException("This converter requires pinned Paper 1.21.7");
    }
    var source = Path.of(arguments[0]).toRealPath();
    var output = Path.of(arguments[1]).toAbsolutePath().normalize();
    if (output.startsWith(source) || Files.exists(output)) {
      throw new IllegalArgumentException("Output must be new and outside the source");
    }
    Files.createDirectory(output);
    var receipts = new LinkedHashMap<String, Object>();
    convertPlayers(source, output, receipts);
    convertStats(source, output, receipts);
    convertMaps(source, output, receipts);
    var receipt = Map.of("schemaVersion", 1, "dataVersion", Version.getCurrentVersion(),
        "files", receipts, "positionValidation", "PENDING", "target26Conversion", "PENDING");
    Files.writeString(output.resolve("conversion-receipt.json"), JSON.toJson(receipt) + "\n",
        StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
    System.out.println("Converted archive companion data: " + receipts.size() + " files");
  }

  private static List<Path> files(Path directory, String suffix) throws IOException {
    try (var stream = Files.list(directory)) {
      var paths = stream.filter(path -> path.getFileName().toString().endsWith(suffix)).sorted().toList();
      for (var path : paths) {
        if (Files.isSymbolicLink(path) || !Files.isRegularFile(path)) {
          throw new IllegalArgumentException("Companion data must be regular files");
        }
      }
      return paths;
    }
  }

  private static CompoundTag read(Path path) throws IOException {
    try (var input = Files.newInputStream(path)) {
      var signature = input.readNBytes(2);
      if (signature.length == 2 && signature[0] == (byte) 0x1f && signature[1] == (byte) 0x8b) {
        return NbtIo.readCompressed(path, NbtAccounter.create(16 * 1024 * 1024));
      }
      if (signature.length != 2 || signature[0] != 10 || Files.size(path) > 16 * 1024 * 1024) {
        throw new IllegalStateException("Unsupported archive NBT encoding: " + path.getFileName());
      }
    }
    try (var input = new DataInputStream(Files.newInputStream(path))) {
      return NbtIo.read(input, NbtAccounter.create(16 * 1024 * 1024));
    }
  }

  private static void convertPlayers(Path source, Path output, Map<String, Object> receipts)
      throws IOException {
    Files.createDirectory(output.resolve("playerdata"));
    for (var path : files(source.resolve("playerdata"), ".dat")) {
      var before = read(path);
      var after = MCDataConverter.convertTag(MCTypeRegistry.PLAYER, before.copy(),
          NbtUtils.getDataVersion(before, -1), Version.getCurrentVersion());
      for (var field : EXPERIENCE) {
        if (!Objects.equals(before.get(field), after.get(field))) {
          throw new IllegalStateException("Player conversion changed experience: " + path.getFileName());
        }
      }
      for (var inventory : List.of("Inventory", "EnderItems")) {
        try {
          verifyInventory(before, after, inventory);
        } catch (IllegalStateException failure) {
          throw new IllegalStateException(path.getFileName() + ": " + inventory, failure);
        }
      }
      after.putInt("DataVersion", Version.getCurrentVersion());
      var target = output.resolve("playerdata").resolve(path.getFileName());
      NbtIo.writeCompressed(after, target);
      if (!read(target).equals(after)) throw new IllegalStateException("Player NBT readback differs");
      receipts.put("playerdata/" + path.getFileName(), Map.of(
          "inventoryStacks", after.getListOrEmpty("Inventory").size(),
          "enderStacks", after.getListOrEmpty("EnderItems").size(),
          "equipmentStacks", after.getCompoundOrEmpty("equipment").size(),
          "experienceUnchanged", true, "dimension", after.getString("Dimension").orElseThrow()));
    }
  }

  private static void verifyInventory(CompoundTag before, CompoundTag after, String name) {
    var oldItems = before.getListOrEmpty(name);
    var newItems = after.getListOrEmpty(name);
    var equipment = name.equals("Inventory") ? after.getCompoundOrEmpty("equipment") : new CompoundTag();
    if (oldItems.size() != newItems.size() + equipment.size()) {
      throw new IllegalStateException("Inventory and equipment stack count changed");
    }
    for (var i = 0; i < oldItems.size(); i++) {
      var oldItem = oldItems.getCompound(i).orElseThrow();
      var slot = oldItem.getByte("Slot").orElseThrow();
      var expected = MCDataConverter.convertTag(MCTypeRegistry.ITEM_STACK, oldItem.copy(),
          NbtUtils.getDataVersion(before, -1), Version.getCurrentVersion());
      CompoundTag actual;
      if (name.equals("Inventory") && slot >= 100 && slot <= 103) {
        var key = List.of("feet", "legs", "chest", "head").get(slot - 100);
        expected.remove("Slot");
        actual = equipment.getCompound(key).orElseThrow();
      } else {
        actual = newItems.compoundStream().filter(item -> item.getByte("Slot").orElseThrow() == slot)
            .findFirst().orElseThrow();
      }
      if (!expected.equals(actual)
          || oldItem.getByte("Count").orElseThrow().intValue() != actual.getInt("count").orElseThrow()
          || !actual.getString("id").orElseThrow().startsWith("minecraft:")) {
        throw new IllegalStateException("Inventory slot, amount or complete item metadata conversion failed");
      }
    }
  }

  private static void convertStats(Path source, Path output, Map<String, Object> receipts)
      throws IOException {
    Files.createDirectory(output.resolve("stats"));
    for (var path : files(source.resolve("stats"), ".json")) {
      var before = JSON.fromJson(Files.readString(path), JsonObject.class);
      // Matches pinned ServerStatsCounter.parseLocal, including its unversioned legacy baseline.
      var from = before.has("DataVersion") ? before.get("DataVersion").getAsInt() : 1343;
      var after = DataFixTypes.STATS.updateToCurrentVersion(DataFixers.getDataFixer(),
          new Dynamic<>(JsonOps.INSTANCE, before.deepCopy()), from).getValue().getAsJsonObject();
      verifyStatistics(before, after);
      after.addProperty("DataVersion", Version.getCurrentVersion());
      var target = output.resolve("stats").resolve(path.getFileName());
      Files.writeString(target, JSON.toJson(after) + "\n", StandardCharsets.UTF_8,
          StandardOpenOption.CREATE_NEW);
      if (!JSON.fromJson(Files.readString(target), JsonObject.class).equals(after)) {
        throw new IllegalStateException("Player statistics readback differs");
      }
      receipts.put("stats/" + path.getFileName(), Map.of("converted", true));
    }
  }

  private static void verifyStatistics(JsonObject before, JsonObject after) {
    var names = Map.of("stat.playOneMinute", "minecraft:play_time", "stat.deaths", "minecraft:deaths",
        "stat.jump", "minecraft:jump", "stat.leaveGame", "minecraft:leave_game");
    for (var entry : names.entrySet()) {
      if (before.has(entry.getKey())) {
        var actual = after.getAsJsonObject("stats").getAsJsonObject("minecraft:custom").get(entry.getValue());
        if (actual == null || actual.getAsInt() != before.get(entry.getKey()).getAsInt()) {
          throw new IllegalStateException("Player statistic changed: " + entry.getKey());
        }
      }
    }
  }

  private static void convertMaps(Path source, Path output, Map<String, Object> receipts)
      throws IOException {
    Files.createDirectory(output.resolve("data"));
    for (var path : files(source.resolve("data"), ".dat")) {
      var name = path.getFileName().toString();
      if (!name.matches("map_[0-9]+\\.dat") && !name.equals("idcounts.dat")) continue;
      var before = read(path);
      var input = before.copy();
      if (name.equals("idcounts.dat") && !before.contains("DataVersion")) {
        // 1.8 stored the map counter as an uncompressed root short, outside saved-data's wrapper.
        if (before.size() != 1 || !before.contains("map")) {
          throw new IllegalStateException("Unrecognized legacy map counter structure");
        }
        // The native saved-data fixer adds its own data wrapper. Supplying a wrapper here would
        // silently nest the map counter, causing modern Minecraft to allocate from zero again.
        input.putInt("map", before.getShort("map").orElseThrow());
      }
      var type = name.equals("idcounts.dat") ? DataFixTypes.SAVED_DATA_MAP_INDEX
          : DataFixTypes.SAVED_DATA_MAP_DATA;
      // Matches pinned DimensionDataStorage.readTagFromDisk, rather than the chunk converter.
      var after = type.updateToCurrentVersion(DataFixers.getDataFixer(), input,
          NbtUtils.getDataVersion(before, 1343));
      if (name.equals("idcounts.dat")) {
        if (after.getCompound("data").orElseThrow().getInt("map").orElseThrow()
            != before.getShort("map").orElseThrow().intValue()) {
          throw new IllegalStateException("Native saved-data map counter changed");
        }
      } else {
        var oldData = before.getCompound("data").orElseThrow();
        var newData = after.getCompound("data").orElseThrow();
        if (!Arrays.equals(oldData.getByteArray("colors").orElseThrow(),
            newData.getByteArray("colors").orElseThrow())) {
          throw new IllegalStateException("Map pixel data changed");
        }
      }
      after.putInt("DataVersion", Version.getCurrentVersion());
      var target = output.resolve("data").resolve(path.getFileName());
      NbtIo.writeCompressed(after, target);
      if (!read(target).equals(after)) throw new IllegalStateException("Map NBT readback differs");
      receipts.put("data/" + name, Map.of("converted", true));
    }
  }
}
