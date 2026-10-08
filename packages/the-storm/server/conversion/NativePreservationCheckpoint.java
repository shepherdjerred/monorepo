import com.google.gson.Gson;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.towns.domain.heritage.HeritageConfig;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.TreeMap;
import net.minecraft.SharedConstants;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.resources.Identifier;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.chunk.storage.RegionFileStorage;
import net.minecraft.world.level.chunk.storage.RegionStorageInfo;

/** Preserve every saved historical chunk without changing terrain or granting wilderness protection. */
public final class NativePreservationCheckpoint {
  private NativePreservationCheckpoint() {}

  public static void main(String[] args) throws IOException, NoSuchAlgorithmException {
    if (args.length != 4) throw new IllegalArgumentException("Expected source region, copied target region, heritage config, new receipt");
    SharedConstants.tryDetectVersion();
    if (!SharedConstants.getCurrentVersion().name().equals("26.2")) throw new IllegalStateException("Native preservation requires pinned Paper 26.2");
    Bootstrap.bootStrap();
    var source = Path.of(args[0]).toRealPath();
    var target = Path.of(args[1]).toRealPath();
    var output = Path.of(args[3]).toAbsolutePath().normalize();
    if (source.startsWith(target) || target.startsWith(source) || Files.exists(output)) {
      throw new IllegalArgumentException("Preservation requires independent copied roots and a new receipt");
    }
    var file = Path.of(args[2]).toRealPath();
    var catalog = StrictYaml.parse(file.toString(), Files.readString(file), HeritageConfig.class)
        .fold(value -> value, errors -> {throw new IllegalArgumentException("Invalid heritage catalog: " + errors);});
    if (!catalog.archiveSha256().equals("89fc7865604b5ab9ecf3030c90a192f8f9c963083cc77135949c953ae6b645fa")) {
      throw new IllegalArgumentException("Preservation catalog names another archive");
    }
    var protectedChunks = new HashSet<ChunkPos>();
    catalog.sites().forEach(site -> site.footprint().forEach(chunk -> {
      if (chunk.world().equals("world")) {
        protectedChunks.add(new ChunkPos(chunk.x(), chunk.z()));
      } else if (!java.util.Set.of("settlement", "rustworks", "rwf").contains(chunk.world())) {
        throw new IllegalArgumentException("Unexpected protected dimension");
      }
    }));
    var seen = new HashSet<ChunkPos>();
    var statuses = new TreeMap<String, Long>();
    var retrogenTargets = new TreeMap<String, Long>();
    var info = new RegionStorageInfo("storm-restoration", Level.OVERWORLD, "chunk");
    long count = 0;
    long changed = 0;
    try (var input = new RegionFileStorage(info, source, true);
        var copied = new RegionFileStorage(info, target, true);
        var files = Files.list(source)) {
      for (var region : files.filter(path -> path.getFileName().toString().matches("r\\.-?[0-9]+\\.-?[0-9]+\\.mca")).sorted().toList()) {
        if (Files.isSymbolicLink(region)) throw new IllegalArgumentException("A native region is a symlink");
        var parts = region.getFileName().toString().split("\\.");
        var rx = Integer.parseInt(parts[1]);
        var rz = Integer.parseInt(parts[2]);
        for (var z = 0; z < 32; z++) for (var x = 0; x < 32; x++) {
          var position = new ChunkPos(rx * 32 + x, rz * 32 + z);
          var before = input.read(position);
          if (before == null) continue;
          if (NbtUtils.getDataVersion(before, -1) != 4903
              || before.getInt("xPos").orElseThrow() != position.x()
              || before.getInt("zPos").orElseThrow() != position.z()) {
            throw new IllegalStateException("Preservation input is outside the native checkpoint");
          }
          if (!before.equals(copied.read(position))) throw new IllegalStateException("Private preservation copy differs from source");
          var status = before.getString("Status").orElseThrow();
          requireStatus(status);
          statuses.merge(status, 1L, Long::sum);
          var retrogen = before.getCompound("below_zero_retrogen");
          if (retrogen.isPresent()) {
            var goal = retrogen.get().getString("target_status").orElseThrow();
            requireStatus(goal);
            retrogenTargets.merge(goal, 1L, Long::sum);
          }
          if (status.equals("minecraft:empty") && retrogen.isEmpty()) {
            throw new IllegalStateException("An empty historical chunk lacks underground-only upgrade metadata");
          }
          if (protectedChunks.contains(position)) seen.add(position);
          {
            var preserved = before.copy();
            preserved.putString("Status", "minecraft:full");
            preserved.remove("below_zero_retrogen");
            preserved.putBoolean("isLightOn", false);
            // Entity/block-entity NBT, sections, biomes, bedrock and every other field are exact.
            var compare = preserved.copy();
            for (var key : java.util.List.of("Status", "below_zero_retrogen", "isLightOn")) {
              compare.remove(key);
              if (before.contains(key)) compare.put(key, before.get(key).copy());
            }
            if (!compare.equals(before)) throw new IllegalStateException("Preservation changed historical chunk contents");
            copied.write(position, preserved);
            if (!preserved.equals(copied.read(position))) throw new IllegalStateException("Protected chunk readback differs");
            if (!preserved.equals(before)) changed++;
          }
          count++;
        }
        copied.flush();
      }
    }
    if (count != 638647 || !seen.equals(protectedChunks)) {
      throw new IllegalStateException("Preservation did not cover every original or protected chunk");
    }
    var facts = new LinkedHashMap<String, Object>();
    facts.put("schemaVersion", 1);
    facts.put("dataVersion", 4903);
    facts.put("chunks", count);
    facts.put("protectedChunks", seen.size());
    facts.put("preservedChunks", count);
    facts.put("changedMetadata", changed);
    facts.put("catalogSha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file))));
    facts.put("inputStatuses", statuses);
    facts.put("inputUndergroundUpgradeTargets", retrogenTargets);
    facts.put("terrainChanged", false);
    facts.put("worldTicks", 0);
    Files.writeString(output, new Gson().toJson(facts) + "\n", StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
  }

  private static void requireStatus(String status) {
    if (!BuiltInRegistries.CHUNK_STATUS.containsKey(Identifier.parse(status))) {
      throw new IllegalStateException("Unknown native generation status");
    }
  }
}
