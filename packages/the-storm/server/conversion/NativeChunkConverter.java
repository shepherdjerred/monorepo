import ca.spottedleaf.dataconverter.minecraft.MCDataConverter;
import ca.spottedleaf.dataconverter.minecraft.datatypes.MCTypeRegistry;
import ca.spottedleaf.dataconverter.minecraft.util.Version;
import com.google.gson.Gson;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
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

/** Converts every archived chunk without loading a world, generating terrain or simulating ticks. */
public final class NativeChunkConverter {
  private NativeChunkConverter() {}

  public static void main(String[] arguments) throws IOException {
    if (arguments.length != 2) throw new IllegalArgumentException("Expected source region and new output");
    SharedConstants.tryDetectVersion();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2")) {
      throw new IllegalStateException("Native conversion requires pinned Paper 26.2");
    }
    Bootstrap.bootStrap();
    var source = Path.of(arguments[0]).toRealPath();
    var output = Path.of(arguments[1]).toAbsolutePath().normalize();
    if (output.startsWith(source) || source.startsWith(output) || Files.exists(output)) {
      throw new IllegalArgumentException("Output must be new and independent of source");
    }
    Files.createDirectory(output);
    var info = new RegionStorageInfo("storm-restoration", Level.OVERWORLD, "chunk");
    long chunks = 0;
    long embeddedEntities = 0;
    long blockEntities = 0;
    long obsoleteBedTags = 0;
    try (var input = new RegionFileStorage(info, source, true);
        var target = new RegionFileStorage(info, output, true)) {
      for (var file : regions(source)) {
        var parts = file.getFileName().toString().split("\\.");
        var rx = Integer.parseInt(parts[1]);
        var rz = Integer.parseInt(parts[2]);
        for (var z = 0; z < 32; z++) {
          for (var x = 0; x < 32; x++) {
            var pos = new ChunkPos(rx * 32 + x, rz * 32 + z);
            var before = input.read(pos);
            if (before == null) continue;
            if (NbtUtils.getDataVersion(before, -1) != 4438) {
              throw new IllegalStateException("Input chunk is outside the reviewed 1.21.7 checkpoint");
            }
            var after = MCDataConverter.convertTag(MCTypeRegistry.CHUNK, before.copy(),
                4438, Version.getCurrentVersion());
            verifyChunk(before, after, pos);
            after.putInt("DataVersion", Version.getCurrentVersion());
            target.write(pos, after);
            if (!after.equals(target.read(pos))) {
              throw new IllegalStateException("Native chunk readback differs");
            }
            chunks++;
            embeddedEntities += after.getListOrEmpty("entities").size();
            blockEntities += after.getListOrEmpty("block_entities").size();
            obsoleteBedTags += before.getListOrEmpty("block_entities").compoundStream()
                .filter(tag -> tag.getString("id").orElseThrow().equals("minecraft:bed")).count();
          }
        }
        target.flush();
        System.out.println("Converted native chunk region " + file.getFileName() + "; chunks=" + chunks);
      }
    }
    var receipt = Map.of("schemaVersion", 1, "dataVersion", Version.getCurrentVersion(),
        "chunks", chunks, "embeddedEntities", embeddedEntities, "blockEntities", blockEntities,
        "obsoleteBedTagsRemoved", obsoleteBedTags, "terrainGeneration", false, "worldTicks", 0);
    Files.writeString(output.resolve("conversion-receipt.json"), new Gson().toJson(receipt) + "\n",
        StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
  }

  private static List<Path> regions(Path directory) throws IOException {
    try (var files = Files.list(directory)) {
      var result = files.filter(file -> file.getFileName().toString().matches("r\\.-?[0-9]+\\.-?[0-9]+\\.mca"))
          .sorted().toList();
      for (var file : result) {
        if (Files.isSymbolicLink(file) || !Files.isRegularFile(file)) {
          throw new IllegalArgumentException("Region files must be regular files");
        }
      }
      return result;
    }
  }

  private static void verifyChunk(CompoundTag before, CompoundTag after, ChunkPos pos) {
    if (after.getInt("xPos").orElseThrow() != pos.x()
        || after.getInt("zPos").orElseThrow() != pos.z()) {
      throw new IllegalStateException("Native conversion moved a chunk");
    }
    var oldSections = before.getList("sections").orElseThrow().compoundStream()
        .map(NativeChunkConverter::sectionContents).toList();
    var newSections = after.getList("sections").orElseThrow().compoundStream()
        .map(NativeChunkConverter::sectionContents).toList();
    if (!oldSections.equals(newSections)) {
      throw new IllegalStateException("Native conversion changed block states or biomes at " + pos);
    }
    verifyEntities(before, after, "entities");
    verifyEntities(before, after, "block_entities");
  }

  private static CompoundTag sectionContents(CompoundTag section) {
    var contents = section.copy();
    // Lighting caches are version-specific and may be discarded by the native converter.
    contents.remove("BlockLight");
    contents.remove("SkyLight");
    return contents;
  }

  private static void verifyEntities(CompoundTag before, CompoundTag after, String name) {
    var input = before.getListOrEmpty(name).compoundStream()
        // Minecraft 26.2 removed bed block entities; their bed blocks and colors stay in sections.
        .filter(tag -> !name.equals("block_entities")
            || !tag.getString("id").orElseThrow().equals("minecraft:bed")).toList();
    var output = after.getListOrEmpty(name).compoundStream().toList();
    if (input.size() != output.size()) {
      throw new IllegalStateException("Native conversion changed retained entity count: " + name);
    }
    var type = name.equals("entities") ? MCTypeRegistry.ENTITY : MCTypeRegistry.TILE_ENTITY;
    for (var index = 0; index < input.size(); index++) {
      var expected = MCDataConverter.convertTag(type, input.get(index).copy(),
          4438, Version.getCurrentVersion());
      if (!expected.equals(output.get(index))) {
        throw new IllegalStateException("Native conversion changed complete entity metadata: " + name);
      }
    }
  }
}
