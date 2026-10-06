import ca.spottedleaf.dataconverter.minecraft.MCDataConverter;
import ca.spottedleaf.dataconverter.minecraft.datatypes.MCTypeRegistry;
import ca.spottedleaf.dataconverter.minecraft.util.Version;
import com.google.gson.Gson;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.chunk.storage.RegionFileStorage;
import net.minecraft.world.level.chunk.storage.RegionStorageInfo;

/** Retains separate entity and point-of-interest storage without loading or ticking chunks. */
public final class NativeAuxiliaryConverter {
  private NativeAuxiliaryConverter() {}

  public static void main(String[] arguments) throws IOException {
    if (arguments.length != 2) throw new IllegalArgumentException("Expected legacy world and new output");
    SharedConstants.tryDetectVersion();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2")) {
      throw new IllegalStateException("Auxiliary conversion requires pinned Paper 26.2");
    }
    Bootstrap.bootStrap();
    var source = Path.of(arguments[0]).toRealPath();
    var output = Path.of(arguments[1]).toAbsolutePath().normalize();
    if (Files.exists(output) || output.startsWith(source) || source.startsWith(output)) {
      throw new IllegalArgumentException("Output must be new and independent of source");
    }
    Files.createDirectory(output);
    var receipts = new LinkedHashMap<String, Object>();
    for (var name : List.of("entities", "poi")) {
      var directory = output.resolve(name);
      Files.createDirectory(directory);
      var info = new RegionStorageInfo("storm-restoration", Level.OVERWORLD, name);
      var positions = new LinkedHashMap<String, Object>();
      try (var input = new RegionFileStorage(info, source.resolve(name), true);
          var target = new RegionFileStorage(info, directory, true);
          var files = Files.list(source.resolve(name))) {
        for (var file : files.sorted().toList()) {
          if (Files.isSymbolicLink(file) || !Files.isRegularFile(file)
              || !file.getFileName().toString().matches("r\\.-?[0-9]+\\.-?[0-9]+\\.mca")) {
            throw new IllegalArgumentException("Unrecognized auxiliary storage file");
          }
          var parts = file.getFileName().toString().split("\\.");
          var rx = Integer.parseInt(parts[1]);
          var rz = Integer.parseInt(parts[2]);
          for (var z = 0; z < 32; z++) {
            for (var x = 0; x < 32; x++) {
              var pos = new ChunkPos(rx * 32 + x, rz * 32 + z);
              var before = input.read(pos);
              if (before == null) continue;
              if (NbtUtils.getDataVersion(before, -1) != 4438) {
                throw new IllegalStateException("Auxiliary input is outside the legacy checkpoint");
              }
              var type = name.equals("entities") ? MCTypeRegistry.ENTITY_CHUNK : MCTypeRegistry.POI_CHUNK;
              var after = MCDataConverter.convertTag(type, before.copy(), 4438, Version.getCurrentVersion());
              if (name.equals("entities")) verifyEntities(before, after);
              else if (!before.getCompound("Sections").orElseThrow()
                  .equals(after.getCompound("Sections").orElseThrow())) {
                throw new IllegalStateException("Native auxiliary conversion changed POI records");
              }
              after.putInt("DataVersion", Version.getCurrentVersion());
              target.write(pos, after);
              if (!after.equals(target.read(pos))) throw new IllegalStateException("Auxiliary readback differs");
              positions.put(pos.x() + "," + pos.z(), Map.of("verified", true,
                  "entities", after.getListOrEmpty("Entities").size()));
            }
          }
          target.flush();
        }
      }
      receipts.put(name, positions);
    }
    Files.writeString(output.resolve("conversion-receipt.json"), new Gson().toJson(Map.of(
        "schemaVersion", 1, "dataVersion", Version.getCurrentVersion(), "storage", receipts,
        "terrainGeneration", false, "worldTicks", 0)) + "\n", StandardCharsets.UTF_8,
        StandardOpenOption.CREATE_NEW);
  }

  private static void verifyEntities(CompoundTag before, CompoundTag after) {
    var input = before.getList("Entities").orElseThrow();
    var output = after.getList("Entities").orElseThrow();
    if (input.size() != output.size()) throw new IllegalStateException("Separate entity count changed");
    if (!before.getIntArray("Position").map(array -> java.util.Arrays.equals(
        array, after.getIntArray("Position").orElseThrow())).orElseThrow()) {
      throw new IllegalStateException("Separate entity storage moved a chunk");
    }
    for (var i = 0; i < input.size(); i++) {
      var expected = MCDataConverter.convertTag(MCTypeRegistry.ENTITY,
          input.getCompound(i).orElseThrow().copy(), 4438, Version.getCurrentVersion());
      if (!expected.equals(output.getCompound(i).orElseThrow())) {
        throw new IllegalStateException("Separate entity metadata changed");
      }
    }
  }
}
