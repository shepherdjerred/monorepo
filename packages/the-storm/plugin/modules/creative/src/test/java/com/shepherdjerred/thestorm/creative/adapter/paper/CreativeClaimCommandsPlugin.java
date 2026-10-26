package com.shepherdjerred.thestorm.creative.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.creative.adapter.export.SchematicFiles;
import com.shepherdjerred.thestorm.creative.app.ClaimBook;
import com.shepherdjerred.thestorm.creative.app.ClaimStore;
import com.shepherdjerred.thestorm.creative.app.ReviewBook;
import com.shepherdjerred.thestorm.creative.app.ReviewBook.Comment;
import com.shepherdjerred.thestorm.creative.app.ReviewBook.Rating;
import com.shepherdjerred.thestorm.creative.app.ReviewStore;
import com.shepherdjerred.thestorm.creative.domain.CreativeConfig;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotId;
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
import org.bukkit.entity.Player;
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

  private static @Nullable ClaimBook claims;
  private @Nullable StormDatabase database;

  static ClaimBook claims() {
    return requireNonNull(claims, "claims");
  }

  @Override
  public void onEnable() {
    failSave = false;
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
            List.of());
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
                new MemoryReviews()),
            (player, location) -> CompletableFuture.completedFuture(player.teleport(location)));
    var root =
        Commands.literal("creative").requires(source -> source.getSender() instanceof Player);
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
