package com.shepherdjerred.thestorm.e2e.maps;

import com.google.gson.Gson;
import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.adapter.content.details.MapDetails;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.ShowcaseControl;
import com.shepherdjerred.thestorm.rwf.app.map.MapLoading;
import com.shepherdjerred.thestorm.rwfbots.app.map.NavLoading;
import io.papermc.paper.command.brigadier.BasicCommand;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.Map;
import java.util.Objects;
import net.kyori.adventure.text.Component;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.plugin.java.JavaPlugin;

/** Observes the actual production cache ports and uses ordinary showcase lifecycle transitions. */
public final class MapLifecycleFixtures implements BasicCommand {
  private static final Gson GSON = new Gson();
  private final JavaPlugin plugin;
  private final Map<String, StringBuilder> expectedContents = new java.util.HashMap<>();

  public MapLifecycleFixtures(JavaPlugin plugin) {
    this.plugin = plugin;
  }

  public void register() {
    plugin
        .getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register("storm-fixture-map-lifecycle", this));
  }

  @Override
  public void execute(CommandSourceStack source, String[] args) {
    if (!(source.getSender() instanceof RemoteConsoleCommandSender))
      throw new IllegalStateException("map lifecycle proof requires the private RCON console");
    var found = plugin.getServer().getPluginManager().getPlugin("TheStorm");
    if (!(found instanceof TheStormPlugin storm))
      throw new IllegalStateException("TheStorm missing");
    if (args.length >= 2 && args[0].startsWith("verify-contents")) {
      source.getSender().sendMessage(Component.text(payloadRequest(storm, args)));
      return;
    }
    if (args.length != 1)
      throw new IllegalArgumentException(
          "expected status, contents, start, stop or verify-contents id payload");
    switch (args[0]) {
      case "contents" -> {
        source.getSender().sendMessage(Component.text(GSON.toJson(contents(storm))));
        return;
      }
      case "start" -> {
        var lobby = storm.service(MatchView.class).current().orElseThrow();
        var error =
            storm.service(ShowcaseControl.class).startSeeded(lobby.matchId(), 8, 610090002L);
        if (error.isPresent()) throw new IllegalStateException(error.orElseThrow());
      }
      case "stop" -> {
        var match = storm.service(MatchView.class).current().orElseThrow();
        var error = storm.service(ShowcaseControl.class).stop(match.matchId());
        if (error.isPresent()) throw new IllegalStateException(error.orElseThrow());
      }
      case "status" -> {
        /* read only */
      }
      default -> throw new IllegalArgumentException("unknown map lifecycle request");
    }
    var heap = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
    source
        .getSender()
        .sendMessage(
            Component.text(
                GSON.toJson(
                    Map.of(
                        "maps",
                        storm.service(MapLoading.class).states(),
                        "navigation",
                        storm.service(NavLoading.class).decoded(),
                        "heapUsed",
                        heap.getUsed(),
                        "heapMax",
                        heap.getMax(),
                        "tick",
                        plugin.getServer().getCurrentTick(),
                        "tickTimes",
                        plugin.getServer().getTickTimes(),
                        "loadedChunks",
                        loadedChunks(storm)))));
  }

  private String payloadRequest(TheStormPlugin storm, String[] args) {
    var id = args[1];
    if (storm.service(MapLoading.class).states().stream().noneMatch(map -> map.id().equals(id)))
      throw new IllegalArgumentException("unknown payload map");
    switch (args[0]) {
      case "verify-contents-begin" -> {
        if (args.length != 2) throw new IllegalArgumentException("expected payload identity");
        expectedContents.clear();
        expectedContents.put(id, new StringBuilder());
      }
      case "verify-contents-append" -> {
        if (args.length != 3 || args[2].length() > 2048)
          throw new IllegalArgumentException("expected bounded payload fragment");
        var payload = Objects.requireNonNull(expectedContents.get(id), "payload not begun");
        if (payload.length() + args[2].length() > 16 * 1024 * 1024)
          throw new IllegalArgumentException("payload proof exceeds bound");
        payload.append(args[2]);
      }
      case "verify-contents" -> {
        if (args.length != 2) throw new IllegalArgumentException("expected payload identity");
        verifyContents(storm, id, Objects.requireNonNull(expectedContents.remove(id)).toString());
        return "{\"matched\":true}";
      }
      default -> throw new IllegalArgumentException("unknown payload request");
    }
    return "{\"received\":true}";
  }

  private void verifyContents(TheStormPlugin storm, String id, String encoded) {
    var map =
        storm.service(MapLoading.class).states().stream()
            .filter(state -> state.id().equals(id) && state.ready())
            .findFirst()
            .orElseThrow();
    var json =
        new String(
            java.util.Base64.getDecoder().decode(encoded), java.nio.charset.StandardCharsets.UTF_8);
    var expected = GSON.fromJson(json, MapDetails.class);
    if (!expected.blocksSha256().equals(map.blocksSha256()))
      throw new IllegalArgumentException("payload proof has another terrain hash");
    DetailsVerifier.verify(
        Objects.requireNonNull(plugin.getServer().getWorld("rwf")), map.region().min(), expected);
  }

  private Map<String, Long> loadedChunks(TheStormPlugin storm) {
    var world = Objects.requireNonNull(plugin.getServer().getWorld("rwf"));
    var loaded = java.util.Arrays.asList(world.getLoadedChunks());
    var counts = new java.util.TreeMap<String, Long>();
    for (var map : storm.service(MapLoading.class).states()) {
      var region = map.region();
      counts.put(
          map.id(),
          loaded.stream()
              .filter(
                  chunk ->
                      chunk.getX() >= (region.min().x() >> 4)
                          && chunk.getX() <= (region.max().x() >> 4)
                          && chunk.getZ() >= (region.min().z() >> 4)
                          && chunk.getZ() <= (region.max().z() >> 4))
              .count());
    }
    return counts;
  }

  private Map<String, MapDetails> contents(TheStormPlugin storm) {
    var world = Objects.requireNonNull(plugin.getServer().getWorld("rwf"));
    var result = new java.util.TreeMap<String, MapDetails>();
    for (var map : storm.service(MapLoading.class).states()) {
      if (!map.ready()) continue;
      result.put(map.id(), contents(world, map));
    }
    return result;
  }

  private record Payload(
      java.util.List<MapDetails.Container> containers, java.util.List<MapDetails.Sign> signs) {}

  private record Chunk(int x, int z) {}

  private static MapDetails contents(org.bukkit.World world, MapLoading.State map) {
    var containers = new ArrayList<MapDetails.Container>();
    var signs = new ArrayList<MapDetails.Sign>();
    var region = map.region();
    for (int x = region.min().x() >> 4; x <= region.max().x() >> 4; x++) {
      for (int z = region.min().z() >> 4; z <= region.max().z() >> 4; z++) {
        captureChunk(world, map, new Chunk(x, z), new Payload(containers, signs));
      }
    }
    return new MapDetails(1, map.blocksSha256(), containers, signs);
  }

  private static void captureChunk(
      org.bukkit.World world, MapLoading.State map, Chunk chunk, Payload payload) {
    if (!world.isChunkLoaded(chunk.x(), chunk.z()))
      throw new IllegalStateException("ready map has unloaded chunks");
    for (var state : world.getChunkAt(chunk.x(), chunk.z()).getTileEntities()) {
      var at =
          new com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos(
              state.getX(), state.getY(), state.getZ());
      if (map.region().contains(at))
        DetailsCapture.capture(state, map.region().min(), payload.containers(), payload.signs());
    }
  }
}
