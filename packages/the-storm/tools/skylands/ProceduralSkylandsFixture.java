package dev.tsmc.skylands;

import com.google.gson.GsonBuilder;
import com.shepherdjerred.thestorm.skylands.adapter.paper.LayeredSkylandsGenerator;
import com.shepherdjerred.thestorm.skylands.adapter.paper.NativeSkyTemplates;
import com.shepherdjerred.thestorm.skylands.domain.SkyCell;
import com.shepherdjerred.thestorm.skylands.domain.SkyPlan;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.bukkit.Bukkit;
import org.bukkit.GameRules;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.plugin.java.JavaPlugin;

/** Extended native acceptance, outside CI. Every block is produced by the repository generator. */
public final class ProceduralSkylandsFixture extends JavaPlugin {
  private record Chunk(int x, int z) {}
  private final ExecutorService planning = Executors.newSingleThreadExecutor();
  private final ArrayDeque<Chunk> pending = new ArrayDeque<>();
  private World world;
  private LayeredSkylandsGenerator generator;
  private List<SkyPlan> witnesses = List.of();
  private int active;
  private int completed;
  private int total;

  @Override public void onEnable() {
    long seed = Long.parseLong(System.getProperty("sky.fixture.seed"));
    String name = "sky_generated";
    generator = LayeredSkylandsGenerator.create(this, name, seed);
    write("template-geometry.json", NativeSkyTemplates.load().geometry());
    var defaults = new TreeMap<String, String>();
    for (var material : org.bukkit.Material.values()) {
      if (material.isBlock()) defaults.put(material.getKey().toString(), material.createBlockData().getAsString());
    }
    write("block-defaults.json", defaults);
    CompletableFuture.supplyAsync(this::discover, planning).whenComplete((plans, error) ->
        Bukkit.getScheduler().runTask(this, () -> {
          if (error != null) { fail(error); return; }
          witnesses = plans;
          world = Objects.requireNonNull(Bukkit.createWorld(WorldCreator.ofKey(NamespacedKey.minecraft(name))
              .environment(World.Environment.NORMAL).seed(seed).generator(generator).generateStructures(true)));
          world.setAutoSave(false);
          world.setGameRule(GameRules.ADVANCE_TIME, false);
          world.setTime(6000);
          queue(plans);
          Bukkit.getScheduler().runTaskTimer(this, this::pump, 1, 1);
        }));
  }

  private List<SkyPlan> discover() {
    var found = new EnumMap<SkyCell.Kind, SkyPlan>(SkyCell.Kind.class);
    int ox = Integer.parseInt(System.getProperty("sky.fixture.cellX", "0"));
    int oz = Integer.parseInt(System.getProperty("sky.fixture.cellZ", "0"));
    for (var radius = 0; radius <= 5; radius++) {
      for (var x = -radius; x <= radius; x++) {
        for (var z = -radius; z <= radius; z++) {
          if (Math.max(Math.abs(x), Math.abs(z)) != radius) continue;
          var cell = new SkyCell(ox + x, oz + z);
          var kind = cell.kind(generator.landscape().seed());
          if (kind == SkyCell.Kind.WILDERNESS || found.containsKey(kind)) continue;
          long before = System.nanoTime();
          var plan = generator.sites().plan(cell);
          getLogger().info("PLANNED " + cell + " kind=" + kind + " pieces=" + plan.pieces().size()
              + " edits=" + plan.edits().size() + " millis=" + (System.nanoTime() - before) / 1_000_000);
          if (!plan.pieces().isEmpty() || !plan.edits().isEmpty()) found.put(kind, plan);
          if (found.size() == 3) return List.copyOf(found.values());
        }
      }
    }
    throw new IllegalStateException("No complete village/mine/city witnesses for seed " + generator.landscape().seed());
  }

  private void queue(List<SkyPlan> plans) {
    var chunks = new LinkedHashSet<Chunk>();
    for (var plan : plans) {
      var points = new ArrayList<com.shepherdjerred.thestorm.skylands.domain.SkyPosition>();
      for (var piece : plan.pieces()) { points.add(piece.bounds().min()); points.add(piece.bounds().max()); }
      for (var edit : plan.edits()) points.add(edit.position());
      int x0 = points.stream().mapToInt(p -> p.x()).min().orElseThrow() - 48;
      int x1 = points.stream().mapToInt(p -> p.x()).max().orElseThrow() + 48;
      int z0 = points.stream().mapToInt(p -> p.z()).min().orElseThrow() - 48;
      int z1 = points.stream().mapToInt(p -> p.z()).max().orElseThrow() + 48;
      for (int x = Math.floorDiv(x0, 16); x <= Math.floorDiv(x1, 16); x++) {
        for (int z = Math.floorDiv(z0, 16); z <= Math.floorDiv(z1, 16); z++) chunks.add(new Chunk(x, z));
      }
    }
    var ordered = new ArrayList<>(chunks);
    if (System.getProperty("sky.fixture.order").equals("reverse")) Collections.reverse(ordered);
    pending.addAll(ordered);
    total = pending.size();
    write("requested-plans.json", plans);
    write("requested-chunks.json", ordered);
    getLogger().info("GENERATION_REQUESTED chunks=" + total + " seed=" + generator.landscape().seed());
  }

  private void pump() {
    while (active < 4 && !pending.isEmpty()) {
      var p = pending.remove();
      active++;
      world.getChunkAtAsync(p.x(), p.z(), true).whenComplete((chunk, error) ->
          Bukkit.getScheduler().runTask(this, () -> {
            if (error != null) { fail(error); return; }
            world.unloadChunkRequest(p.x(), p.z());
            active--; completed++;
            if (completed % 128 == 0) getLogger().info("GENERATION_PROGRESS " + completed + "/" + total);
            if (completed == total) finish();
          }));
    }
  }

  private void finish() {
    world.save();
    write("generation-result.json", Map.of("seed", generator.landscape().seed(), "chunks", completed,
        "order", System.getProperty("sky.fixture.order"), "witnesses", witnesses,
        "scope", "Fresh world; repository generator only; no post-generation placements"));
    getLogger().info("PROCEDURAL_NATIVE_READY chunks=" + completed);
    Bukkit.getScheduler().cancelTasks(this);
    Bukkit.shutdown();
  }

  private void write(String name, Object value) {
    try { Files.writeString(Path.of(name), new GsonBuilder().setPrettyPrinting().create().toJson(value)); }
    catch (java.io.IOException error) { throw new IllegalStateException(error); }
  }

  private void fail(Throwable error) {
    getLogger().log(java.util.logging.Level.SEVERE, "Native generation rejected", error);
    Bukkit.shutdown();
  }

  @Override public void onDisable() { planning.close(); }
}
