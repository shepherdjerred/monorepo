package com.shepherdjerred.thestorm.e2e.maps;

import com.google.gson.Gson;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.shepherdjerred.thestorm.rwf.adapter.content.SchematicReader;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.extent.clipboard.BlockArrayClipboard;
import com.sk89q.worldedit.extent.clipboard.io.BuiltInClipboardFormat;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.regions.CuboidRegion;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.bukkit.Chunk;
import org.bukkit.ChunkSnapshot;
import org.bukkit.World;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/** Converts only copied legacy worlds on an offline disposable Paper server. */
public final class MapExportFixtures implements AutoCloseable {
  private static final Gson GSON = new Gson();
  private final JavaPlugin plugin;
  private final World world;
  private final ExecutorService writer = Executors.newSingleThreadExecutor();
  private final List<ChunkSnapshot> snapshots = new ArrayList<>();
  private final List<RemovedData> removed = new ArrayList<>();
  private volatile String status = "{\"state\":\"idle\"}";
  private boolean started;
  private @Nullable CompletableFuture<Chunk> loading;
  private final Set<SourceChunk> sourceChunks = new HashSet<>();

  private record SourceChunk(int x, int z) {}

  /** Contents omitted by the gameplay terrain contract, with their original coordinates. */
  private record RemovedData(String kind, String type, int x, int y, int z) {}

  private record Bounds(int minX, int minZ, int maxX, int maxZ, int requiredY) {
    Bounds {
      if (maxX < minX
          || maxZ < minZ
          || requiredY < 0
          || requiredY > 255
          || (long) (maxX - minX + 1) * (maxZ - minZ + 1) * 256 > 64_000_000)
        throw new IllegalArgumentException("invalid legacy export bounds");
    }
  }

  public MapExportFixtures(JavaPlugin plugin, World world) {
    this.plugin = plugin;
    this.world = world;
  }

  public void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event ->
                event
                    .registrar()
                    .register(
                        Commands.literal("storm-fixture-map-export")
                            .requires(
                                source -> source.getSender() instanceof RemoteConsoleCommandSender)
                            .then(
                                Commands.argument("request", StringArgumentType.greedyString())
                                    .executes(
                                        command -> {
                                          command
                                              .getSource()
                                              .getSender()
                                              .sendMessage(
                                                  command(
                                                      StringArgumentType.getString(
                                                          command, "request")));
                                          return 1;
                                        }))
                            .build()));
  }

  private String command(String request) {
    if (request.equals("status")) return status;
    var parts = request.split(" ", -1);
    if (parts.length != 6 || !parts[0].equals("start"))
      throw new IllegalArgumentException("expected start minX minZ maxX maxZ requiredY or status");
    if (started) throw new IllegalStateException("one export per disposable world");
    var bounds =
        new Bounds(
            Integer.parseInt(parts[1]),
            Integer.parseInt(parts[2]),
            Integer.parseInt(parts[3]),
            Integer.parseInt(parts[4]),
            Integer.parseInt(parts[5]));
    started = true;
    status = "{\"state\":\"reading\"}";
    writer.execute(
        () -> {
          try {
            var json =
                Files.readString(plugin.getDataFolder().toPath().resolve("source-chunks.json"));
            var chunks = GSON.fromJson(json, SourceChunk[].class);
            if (chunks.length == 0) throw new IllegalArgumentException("no audited source chunks");
            for (var chunk : chunks) {
              if (!sourceChunks.add(chunk))
                throw new IllegalArgumentException("duplicate source chunk");
            }
            plugin
                .getServer()
                .getScheduler()
                .runTask(plugin, () -> capture(bounds, bounds.minX() >> 4, bounds.minZ() >> 4));
          } catch (Exception failure) {
            fail(failure);
          }
        });
    return status;
  }

  private void capture(Bounds bounds, int chunkX, int chunkZ) {
    var request = new SourceChunk(chunkX, chunkZ);
    if (!sourceChunks.contains(request)) {
      next(bounds, chunkX, chunkZ);
      return;
    }
    // Legacy conversion leaves saved chunks at SPAWN; complete their remaining status work.
    loading =
        world
            .getChunkAtAsync(chunkX, chunkZ, true)
            .whenComplete(
                (chunk, failure) ->
                    plugin
                        .getServer()
                        .getScheduler()
                        .runTask(plugin, () -> captured(bounds, request, chunk, failure)));
  }

  private void captured(
      Bounds bounds, SourceChunk request, @Nullable Chunk chunk, @Nullable Throwable failure) {
    if (failure != null) {
      fail(failure);
      return;
    }
    if (chunk == null) {
      fail(new IllegalStateException("missing source chunk " + request.x() + "," + request.z()));
      return;
    }
    snapshots.add(chunk.getChunkSnapshot(false, false, false));
    recordRemoved(bounds, chunk);
    next(bounds, request.x(), request.z());
  }

  private void recordRemoved(Bounds bounds, Chunk chunk) {
    for (var block : chunk.getTileEntities()) {
      if (inside(bounds, block.getX(), block.getZ()))
        removed.add(
            new RemovedData(
                "block-entity",
                block.getType().getKey().toString(),
                block.getX(),
                block.getY(),
                block.getZ()));
    }
    for (var entity : chunk.getEntities()) {
      var at = entity.getLocation();
      if (inside(bounds, at.getBlockX(), at.getBlockZ()))
        removed.add(
            new RemovedData(
                "entity",
                entity.getType().getKey().toString(),
                at.getBlockX(),
                at.getBlockY(),
                at.getBlockZ()));
    }
  }

  private void next(Bounds bounds, int chunkX, int chunkZ) {
    if (chunkZ < bounds.maxZ() >> 4)
      plugin.getServer().getScheduler().runTask(plugin, () -> capture(bounds, chunkX, chunkZ + 1));
    else if (chunkX < bounds.maxX() >> 4)
      plugin
          .getServer()
          .getScheduler()
          .runTask(plugin, () -> capture(bounds, chunkX + 1, bounds.minZ() >> 4));
    else {
      status = "{\"state\":\"encoding\"}";
      writer.execute(() -> export(bounds));
    }
  }

  private static boolean inside(Bounds bounds, int x, int z) {
    return x >= bounds.minX() && x <= bounds.maxX() && z >= bounds.minZ() && z <= bounds.maxZ();
  }

  private void export(Bounds bounds) {
    try {
      var height = height(bounds);
      int minY = height.min();
      int maxY = height.max();
      var min = BlockVector3.at(bounds.minX(), minY, bounds.minZ());
      var max = BlockVector3.at(bounds.maxX(), maxY, bounds.maxZ());
      var clipboard = new BlockArrayClipboard(new CuboidRegion(min, max));
      clipboard.setOrigin(min);
      for (var snapshot : snapshots) {
        copySnapshot(bounds, snapshot, clipboard, height);
      }
      var bytes = new ByteArrayOutputStream();
      try (var output = BuiltInClipboardFormat.SPONGE_V3_SCHEMATIC.getWriter(bytes)) {
        output.write(clipboard);
      }
      var schematic = SchematicReader.read(new ByteArrayInputStream(bytes.toByteArray()));
      var directory = plugin.getDataFolder().toPath().resolve("map-export");
      Files.createDirectories(directory);
      Files.write(directory.resolve("blocks.schem"), bytes.toByteArray());
      Files.writeString(directory.resolve("removed-data.json"), GSON.toJson(removed));
      status =
          "{\"state\":\"complete\",\"minY\":"
              + minY
              + ",\"maxY\":"
              + maxY
              + ",\"removedData\":"
              + removed.size()
              + ",\"blocksSha256\":\""
              + schematic.sha256()
              + "\"}";
    } catch (Exception failure) {
      fail(failure);
    } finally {
      snapshots.clear();
    }
  }

  private record Height(int min, int max) {}

  private Height height(Bounds bounds) {
    int min = 256;
    int max = bounds.requiredY();
    for (var snapshot : snapshots) {
      var height = snapshotHeight(bounds, snapshot);
      min = Math.min(min, height.min());
      max = Math.max(max, height.max());
    }
    if (min == 256) throw new IllegalStateException("source region contains no terrain");
    return new Height(min, Math.min(255, max + 3)); // source terrain/spawn headroom
  }

  private static Height snapshotHeight(Bounds bounds, ChunkSnapshot snapshot) {
    int min = 256;
    int max = bounds.requiredY();
    for (int y = 0; y < 256; y++) {
      for (int z = 0; z < 16; z++) {
        for (int x = 0; x < 16; x++) {
          if (inside(bounds, snapshot.getX() * 16 + x, snapshot.getZ() * 16 + z)
              && !snapshot.getBlockType(x, y, z).isAir()) {
            min = Math.min(min, y);
            max = Math.max(max, y);
          }
        }
      }
    }
    return new Height(min, max);
  }

  private static void copySnapshot(
      Bounds bounds, ChunkSnapshot snapshot, BlockArrayClipboard clipboard, Height height)
      throws com.sk89q.worldedit.WorldEditException {
    for (int y = height.min(); y <= height.max(); y++) {
      for (int z = 0; z < 16; z++) {
        for (int x = 0; x < 16; x++) {
          int wx = snapshot.getX() * 16 + x;
          int wz = snapshot.getZ() * 16 + z;
          if (inside(bounds, wx, wz))
            clipboard.setBlock(
                BlockVector3.at(wx, y, wz), BukkitAdapter.adapt(snapshot.getBlockData(x, y, z)));
        }
      }
    }
  }

  private void fail(Throwable failure) {
    plugin.getLogger().log(java.util.logging.Level.SEVERE, "Map export failed", failure);
    status =
        "{\"state\":\"failed\",\"message\":"
            + GSON.toJson(Objects.toString(failure.getMessage()))
            + "}";
  }

  @Override
  public void close() {
    if (loading != null) loading.cancel(true);
    writer.shutdownNow();
  }
}
