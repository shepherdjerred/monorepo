package com.shepherdjerred.thestorm.essentials.adapter.files;

import com.shepherdjerred.thestorm.core.nbt.NbtReader;
import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipFile;

/** Reads original player respawns without treating another historical world as the main map. */
public final class LegacyRespawns {
  private LegacyRespawns() {}

  public record Spot(String world, int x, int y, int z) {}

  public record Found(UUID player, Spot spot) {}

  public record Scan(List<Found> found, int withoutWorld) {
    public Scan {
      found = List.copyOf(found);
    }
  }

  /** The original Bukkit world name is evidence; a missing name must never be guessed. */
  static Optional<Spot> read(Map<String, Object> root) {
    var hasX = root.containsKey("SpawnX");
    var hasY = root.containsKey("SpawnY");
    var hasZ = root.containsKey("SpawnZ");
    if (!hasX && !hasY && !hasZ) return Optional.empty();
    if (!(root.get("SpawnX") instanceof Integer x)
        || !(root.get("SpawnY") instanceof Integer y)
        || !(root.get("SpawnZ") instanceof Integer z)) {
      throw new IllegalStateException("invalid legacy spawn coordinates");
    }
    var world = root.get("SpawnWorld");
    if (world == null) return Optional.empty();
    if (!(world instanceof String name) || name.isBlank()) {
      throw new IllegalStateException("invalid legacy spawn world");
    }
    return Optional.of(new Spot(name, x, y, z));
  }

  /** Reads UUID-named files immediately under a world's playerdata directory in a ZIP. */
  public static Scan readArchive(Path archive, String worldRoot) throws IOException {
    var found = new ArrayList<Found>();
    var withoutWorld = 0;
    var players = new HashSet<UUID>();
    var prefix = worldRoot + "/playerdata/";
    try (var zip = new ZipFile(archive.toFile())) {
      var entries = zip.entries();
      while (entries.hasMoreElements()) {
        var entry = entries.nextElement();
        var name = entry.getName();
        if (!name.startsWith(prefix) || !name.endsWith(".dat")) continue;
        var filename = name.substring(prefix.length(), name.length() - 4);
        UUID player;
        try {
          player = UUID.fromString(filename);
        } catch (IllegalArgumentException ignored) {
          continue;
        }
        if (!players.add(player)) throw new IOException("duplicate player data: " + player);
        try (var input =
            new DataInputStream(
                new BufferedInputStream(new GZIPInputStream(zip.getInputStream(entry))))) {
          var root = NbtReader.readRoot(input);
          if (input.read() != -1) throw new IOException("data follows legacy player root: " + name);
          var spot = read(root);
          if (spot.isPresent()) found.add(new Found(player, spot.orElseThrow()));
          else if (root.containsKey("SpawnX") && !root.containsKey("SpawnWorld")) withoutWorld++;
        }
      }
    }
    return new Scan(found, withoutWorld);
  }
}
