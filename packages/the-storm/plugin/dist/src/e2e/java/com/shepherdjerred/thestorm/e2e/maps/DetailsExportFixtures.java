package com.shepherdjerred.thestorm.e2e.maps;

import com.google.gson.Gson;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.shepherdjerred.thestorm.rwf.adapter.content.details.MapDetails;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.bukkit.World;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.plugin.java.JavaPlugin;

/** Reads allowed payloads from copied, natively migrated worlds; never installs live content. */
public final class DetailsExportFixtures implements AutoCloseable {
  private static final Gson GSON = new Gson();
  private final JavaPlugin plugin;
  private final World world;
  private final ExecutorService writer = Executors.newSingleThreadExecutor();
  private final List<MapDetails.Container> containers = new ArrayList<>();
  private final List<MapDetails.Sign> signs = new ArrayList<>();
  private volatile String status = "{\"state\":\"idle\"}";
  private boolean started;

  private record Chunk(int x, int z) {}

  private record Request(BlockPos min, BlockPos max, String hash) {
    Request {
      if (min.x() > max.x()
          || min.y() > max.y()
          || min.z() > max.z()
          || min.y() < -64
          || max.y() > 319
          || !hash.matches("[a-f0-9]{64}"))
        throw new IllegalArgumentException("invalid details export region");
    }

    boolean contains(int x, int y, int z) {
      return x >= min.x()
          && x <= max.x()
          && y >= min.y()
          && y <= max.y()
          && z >= min.z()
          && z <= max.z();
    }
  }

  public DetailsExportFixtures(JavaPlugin plugin, World world) {
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
                        Commands.literal("storm-fixture-map-details")
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

  private String command(String text) {
    if (text.equals("status")) return status;
    var parts = text.split(" ", -1);
    if (parts.length != 8 || !parts[0].equals("start"))
      throw new IllegalArgumentException(
          "expected start minX minY minZ maxX maxY maxZ terrainHash");
    if (started) throw new IllegalStateException("one details export per disposable world");
    var request =
        new Request(
            new BlockPos(
                Integer.parseInt(parts[1]), Integer.parseInt(parts[2]), Integer.parseInt(parts[3])),
            new BlockPos(
                Integer.parseInt(parts[4]), Integer.parseInt(parts[5]), Integer.parseInt(parts[6])),
            parts[7]);
    started = true;
    status = "{\"state\":\"reading\"}";
    writer.execute(
        () -> {
          try {
            var chunks =
                GSON.fromJson(
                    Files.readString(plugin.getDataFolder().toPath().resolve("source-chunks.json")),
                    Chunk[].class);
            if (chunks.length == 0)
              throw new IllegalArgumentException("missing audited source chunks");
            plugin
                .getServer()
                .getScheduler()
                .runTask(plugin, () -> capture(request, List.of(chunks), 0));
          } catch (Exception failure) {
            fail(failure);
          }
        });
    return status;
  }

  private void capture(Request request, List<Chunk> chunks, int index) {
    if (index == chunks.size()) {
      status = "{\"state\":\"encoding\"}";
      writer.execute(() -> export(request));
      return;
    }
    var chunk = chunks.get(index);
    var loading = world.getChunkAtAsync(chunk.x(), chunk.z(), true);
    var _ =
        loading.whenComplete(
            (loaded, failure) ->
                plugin
                    .getServer()
                    .getScheduler()
                    .runTask(
                        plugin,
                        () -> {
                          if (failure != null) {
                            fail(failure);
                            return;
                          }
                          try {
                            for (var state : loaded.getTileEntities()) capture(request, state);
                            capture(request, chunks, index + 1);
                          } catch (RuntimeException problem) {
                            fail(problem);
                          }
                        }));
  }

  private void capture(Request request, org.bukkit.block.BlockState state) {
    if (!request.contains(state.getX(), state.getY(), state.getZ())) return;
    DetailsCapture.capture(state, request.min(), containers, signs);
  }

  private void export(Request request) {
    try {
      var details = new MapDetails(1, request.hash(), containers, signs);
      var directory = plugin.getDataFolder().toPath().resolve("map-details");
      Files.createDirectories(directory);
      Files.writeString(directory.resolve("details.json"), GSON.toJson(details));
      status =
          GSON.toJson(
              java.util.Map.of(
                  "state", "complete", "containers", containers.size(), "signs", signs.size()));
    } catch (Exception failure) {
      fail(failure);
    }
  }

  private void fail(Throwable failure) {
    plugin
        .getLogger()
        .log(java.util.logging.Level.SEVERE, "Native map details export failed", failure);
    status = GSON.toJson(java.util.Map.of("state", "failed", "message", failure.toString()));
  }

  @Override
  public void close() {
    writer.shutdownNow();
  }
}
