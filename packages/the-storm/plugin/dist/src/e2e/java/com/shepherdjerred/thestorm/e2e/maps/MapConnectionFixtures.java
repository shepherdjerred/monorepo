package com.shepherdjerred.thestorm.e2e.maps;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapBlocks;
import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.adapter.content.SchematicReader;
import com.shepherdjerred.thestorm.rwf.adapter.content.SchematicWriter;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.sk89q.worldedit.WorldEdit;
import com.sk89q.worldedit.extension.platform.Capability;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.bukkit.Bukkit;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.plugin.java.JavaPlugin;

/** Repairs copied catalog schematics on a disposable server with its loaded vanilla block tags. */
public final class MapConnectionFixtures implements AutoCloseable {
  private static final Gson GSON = new Gson();
  private final JavaPlugin plugin;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private volatile String status = "{\"state\":\"idle\"}";
  private boolean started;

  private record Converted(String id, int changed, String before, String after) {}

  private record Wire(int version, List<String> states, List<String> result) {}

  private static void validateContract() {
    try (var stream =
        MapConnectionFixtures.class.getResourceAsStream("/rwf-map-connections.json")) {
      if (stream == null) throw new IllegalStateException("Map connection contract missing");
      var wire = GSON.fromJson(new InputStreamReader(stream, StandardCharsets.UTF_8), Wire.class);
      var fields =
          Arrays.stream(Converted.class.getRecordComponents())
              .map(java.lang.reflect.RecordComponent::getName)
              .toList();
      if (wire.version() != 1
          || !wire.states().equals(List.of("idle", "working", "complete", "failed"))
          || !wire.result().equals(fields))
        throw new IllegalStateException("Map connection contract differs from producer");
    } catch (IOException failure) {
      throw new IllegalStateException("Map connection contract unreadable", failure);
    }
  }

  public MapConnectionFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  public void register() {
    validateContract();
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event ->
                event
                    .registrar()
                    .register(
                        Commands.literal("storm-fixture-map-connections")
                            .requires(
                                source -> source.getSender() instanceof RemoteConsoleCommandSender)
                            .then(
                                Commands.literal("status")
                                    .executes(
                                        command -> {
                                          command.getSource().getSender().sendMessage(status);
                                          return 1;
                                        }))
                            .then(
                                Commands.literal("start")
                                    .executes(
                                        command -> {
                                          if (started)
                                            throw new IllegalStateException(
                                                "One catalog per disposable server");
                                          started = true;
                                          status = "{\"state\":\"working\"}";
                                          var version =
                                              WorldEdit.getInstance()
                                                  .getPlatformManager()
                                                  .queryCapability(Capability.WORLD_EDITING)
                                                  .getDataVersion();
                                          worker.execute(() -> convert(version));
                                          command.getSource().getSender().sendMessage(status);
                                          return 1;
                                        }))
                            .build()));
  }

  private void convert(int version) {
    try {
      var maps = plugin.getDataFolder().toPath().resolveSibling("TheStorm/rwf/maps");
      var output = plugin.getDataFolder().toPath().resolve("map-connections");
      Files.createDirectories(output);
      Files.writeString(output.resolve("checks.json"), GSON.toJson(MapConnectionChecks.run()));
      var results = new ArrayList<Converted>();
      try (var folders = Files.list(maps)) {
        for (var folder : folders.filter(Files::isDirectory).sorted().toList()) {
          Schematic input;
          try (var stream = Files.newInputStream(folder.resolve("blocks.schem"))) {
            input = SchematicReader.read(stream);
          }
          // Authored schematics may deliberately specify wall posts and other derived shapes.
          // Only legacy world imports lost these states during version conversion.
          var imported = imported(folder);
          var result =
              imported ? MapConnections.normalize(input) : new MapConnections.Result(input, 0);
          var again = imported ? MapConnections.normalize(result.blocks()) : result;
          if (again.changed() != 0 || !again.blocks().sha256().equals(result.blocks().sha256()))
            throw new IllegalStateException("Connections are not idempotent: " + folder);
          var blocks = result.blocks();
          MapBlocks.resolve(
              blocks,
              new Cuboid(
                  new BlockPos(0, 0, 0),
                  new BlockPos(blocks.width() - 1, blocks.height() - 1, blocks.length() - 1)),
              Bukkit::createBlockData);
          var id = folder.getFileName().toString();
          Files.write(
              output.resolve(id + ".schem"), SchematicWriter.write(result.blocks(), version));
          results.add(
              new Converted(id, result.changed(), input.sha256(), result.blocks().sha256()));
          plugin.getLogger().info("Normalized " + id + ": " + result.changed() + " blocks");
        }
      }
      Files.writeString(output.resolve("results.json"), GSON.toJson(results));
      status = "{\"state\":\"complete\"}";
    } catch (Exception failure) {
      plugin.getLogger().log(java.util.logging.Level.SEVERE, "Map connections failed", failure);
      status = "{\"state\":\"failed\",\"message\":" + GSON.toJson(failure.toString()) + "}";
    }
  }

  private static boolean imported(java.nio.file.Path folder) throws java.io.IOException {
    var sourceFile = folder.resolve("source.json");
    var imported = false;
    if (Files.exists(sourceFile)) {
      var source = GSON.fromJson(Files.readString(sourceFile), JsonObject.class);
      imported = source.has("original");
      if (!imported && !source.get("kind").getAsString().equals("original-mc-build-program"))
        throw new IllegalStateException("Unknown map producer: " + folder);
    } else if (!folder.getFileName().toString().equals("training-yard")) {
      throw new IllegalStateException("Missing map producer: " + folder);
    }
    return imported;
  }

  @Override
  public void close() {
    worker.shutdownNow();
  }
}
