package com.shepherdjerred.thestorm.creative.adapter.paper;

import static java.nio.charset.StandardCharsets.UTF_8;
import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.creative.adapter.bundle.BundledTemplate;
import com.shepherdjerred.thestorm.creative.adapter.export.SchematicFiles;
import com.shepherdjerred.thestorm.creative.adapter.worldedit.PlotSchematics;
import com.shepherdjerred.thestorm.creative.app.ClaimBook;
import com.shepherdjerred.thestorm.creative.app.ClaimStore;
import com.shepherdjerred.thestorm.creative.app.ReviewBook;
import com.shepherdjerred.thestorm.creative.app.ReviewBook.Comment;
import com.shepherdjerred.thestorm.creative.app.ReviewBook.Rating;
import com.shepherdjerred.thestorm.creative.app.ReviewStore;
import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
import com.shepherdjerred.thestorm.creative.domain.RecoveredPlot;
import com.shepherdjerred.thestorm.creative.domain.StoredClaim;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.io.File;
import java.io.IOException;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.random.RandomGenerator;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * Enables only the creative plot commands, with an in-memory claim store. Not final: MockBukkit
 * subclasses plugins.
 */
public class CreativeClaimCommandsPlugin extends JavaPlugin {

  /** Where the test wants the database; set before MockBukkit loads the plugin. */
  static @Nullable Path directory;

  /** The next save fails and the player must stay where they are. */
  static boolean failSave;

  /** Catalog rows for one test. Read once when the plugin enables, then cleared. */
  static List<RecoveredPlot> catalog = List.of();

  private static @Nullable ClaimBook claims;
  private @Nullable StormDatabase database;

  static ClaimBook claims() {
    return requireNonNull(claims, "claims");
  }

  @Override
  public void onEnable() {
    failSave = false;
    var catalog = List.copyOf(CreativeClaimCommandsPlugin.catalog);
    CreativeClaimCommandsPlugin.catalog = List.of();
    var directory = requireNonNull(CreativeClaimCommandsPlugin.directory, "directory");
    var world = getServer().getWorld("creative");
    if (world == null) {
      throw new IllegalStateException("creative world is not loaded");
    }
    var database = StormDatabase.open(directory.resolve("claims.db"));
    this.database = database;
    var config =
        new CreativeConfig(
            "creative",
            PlotGrid.PLOT_WIDTH,
            PlotGrid.ROAD_WIDTH,
            PlotGrid.ROAD_OFFSET_X,
            PlotGrid.ROAD_OFFSET_Z,
            PlotGrid.SURFACE_Y,
            PlotGrid.SURVEYED_BORDER_CENTER_X,
            PlotGrid.SURVEYED_BORDER_CENTER_Z,
            PlotGrid.SURVEYED_BORDER_SIZE,
            2,
            200,
            8,
            140,
            20,
            catalog);
    var book = new ClaimBook(config.catalog());
    book.replace(List.of());
    claims = book;
    var reviews = new ReviewBook();
    reviews.replace(List.of(), List.of());
    var plots =
        new CreativePlots(
            new CreativePlots.Parts(
                new ModuleContext(
                    this,
                    getLifecycleManager(),
                    new PaperScheduler(this),
                    new DirectComputePool(),
                    database,
                    new Services(),
                    directory,
                    InstantSource.system(),
                    RandomGenerator.getDefault(),
                    getComponentLogger(),
                    ProductAnalytics.disabled()),
                book,
                new MemoryClaims(),
                config,
                world,
                () -> {},
                new SchematicFiles(database, new File(directory.toFile(), "creative-schematics")),
                config.grid()::generated,
                reviews,
                new MemoryReviews(),
                BundledTemplate.read(config.grid(), "/creative-empty-plot.bin"),
                new MemoryColumns()),
            (player, location) -> CompletableFuture.completedFuture(player.teleport(location)));
    var root = Commands.literal("creative");
    plots.attach(root);
    getLifecycleManager()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> event.registrar().register(root.build(), "Claim a creative plot"));
  }

  @Override
  public void onDisable() {
    claims = null;
    if (database != null) {
      database.close();
    }
  }

  private static final class MemoryClaims implements ClaimStore {

    private final Map<PlotId, StoredClaim> rows = new HashMap<>();

    @Override
    public CompletableFuture<List<StoredClaim>> loadAll() {
      return CompletableFuture.completedFuture(List.copyOf(rows.values()));
    }

    @Override
    public CompletableFuture<Void> save(StoredClaim claim) {
      return saveAll(List.of(claim));
    }

    @Override
    public CompletableFuture<Void> saveAll(List<StoredClaim> claims) {
      if (failSave) {
        return CompletableFuture.failedFuture(new IOException("creative claim save failed"));
      }
      for (var claim : claims) {
        rows.put(claim.id(), claim);
      }
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<Void> delete(PlotId id) {
      rows.remove(id);
      return CompletableFuture.completedFuture(null);
    }
  }

  /** Block snapshots for move tests. MockBukkit has no WorldEdit plugin. */
  private static final class MemoryColumns implements PlotSchematics.Columns {

    @Override
    public byte[] copy(PlotSchematics.Span span) {
      var lines = new StringBuilder();
      for (var block : placed(span)) {
        var type = block.getType();
        if (type == Material.AIR) {
          continue;
        }
        lines
            .append(block.getX())
            .append(',')
            .append(block.getY())
            .append(',')
            .append(block.getZ())
            .append(',')
            .append(type.name())
            .append('\n');
      }
      return lines.toString().getBytes(UTF_8);
    }

    @Override
    public Optional<PlotSchematics.Problem> paste(PlotSchematics.Span span, byte[] bytes) {
      for (var block : placed(span)) {
        if (block.getType() != Material.AIR) {
          block.setType(Material.AIR);
        }
      }
      var text = new String(bytes, UTF_8);
      if (!text.isEmpty()) {
        for (var line : text.split("\n", -1)) {
          if (line.isEmpty()) {
            continue;
          }
          var part = line.split(",", -1);
          span.world()
              .getBlockAt(
                  Integer.parseInt(part[0]), Integer.parseInt(part[1]), Integer.parseInt(part[2]))
              .setType(Material.valueOf(part[3]));
        }
      }
      return Optional.empty();
    }

    private static List<Block> placed(PlotSchematics.Span span) {
      var bounds = span.bounds();
      var found = new ArrayList<Block>();
      for (var block : stored(span.world())) {
        if (block.getX() < bounds.minX()
            || block.getX() > bounds.maxX()
            || block.getZ() < bounds.minZ()
            || block.getZ() > bounds.maxZ()
            || block.getY() < span.minY()
            || block.getY() > span.maxY()) {
          continue;
        }
        found.add(block);
      }
      return found;
    }

    private static List<Block> stored(org.bukkit.World world) {
      try {
        var field = world.getClass().getDeclaredField("blocks");
        field.setAccessible(true);
        var stored = field.get(world);
        if (!(stored instanceof Map<?, ?> map)) {
          throw new IllegalStateException("creative test world has no block map");
        }
        var found = new ArrayList<Block>();
        for (var value : map.values()) {
          if (value instanceof Block block) {
            found.add(block);
          }
        }
        return found;
      } catch (ReflectiveOperationException failure) {
        throw new IllegalStateException("creative test world blocks were not read", failure);
      }
    }
  }

  /** Ratings and comments kept in memory for command tests. */
  private static final class MemoryReviews implements ReviewStore {

    private final Map<PlotId, Map<UUID, Integer>> ratings = new HashMap<>();
    private final List<Comment> comments = new ArrayList<>();

    @Override
    public CompletableFuture<Snapshot> load() {
      var scores = new ArrayList<Rating>();
      for (var plot : ratings.entrySet()) {
        for (var score : plot.getValue().entrySet()) {
          scores.add(new Rating(plot.getKey(), score.getKey(), score.getValue()));
        }
      }
      return CompletableFuture.completedFuture(new Snapshot(scores, List.copyOf(comments)));
    }

    @Override
    public CompletableFuture<Void> rate(
        Optional<StoredClaim> ensure, PlotId plot, UUID player, int score) {
      ratings.computeIfAbsent(plot, ignored -> new HashMap<>()).put(player, score);
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<Void> comment(Optional<StoredClaim> ensure, Comment comment) {
      comments.add(comment);
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<Void> delete(PlotId plot, UUID player, int posted) {
      comments.removeIf(
          comment ->
              comment.plot().equals(plot)
                  && comment.player().equals(player)
                  && comment.posted() == posted);
      return CompletableFuture.completedFuture(null);
    }
  }
}
