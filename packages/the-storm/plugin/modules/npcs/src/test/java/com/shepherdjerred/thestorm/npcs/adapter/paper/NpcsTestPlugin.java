package com.shepherdjerred.thestorm.npcs.adapter.paper;

import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.npcs.adapter.content.ContentLoader;
import com.shepherdjerred.thestorm.npcs.app.ActionRegistry;
import com.shepherdjerred.thestorm.npcs.app.ContentSource;
import com.shepherdjerred.thestorm.npcs.app.DialogPresenter;
import com.shepherdjerred.thestorm.npcs.app.DialogueRegistry;
import com.shepherdjerred.thestorm.npcs.app.NpcCatalog;
import com.shepherdjerred.thestorm.npcs.app.Trainer;
import com.shepherdjerred.thestorm.npcs.app.TrainerWording;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.content.Content;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentProblem;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentRules;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen;
import com.shepherdjerred.thestorm.npcs.domain.geo.ChunkKey;
import com.shepherdjerred.thestorm.tracks.app.PurchaseProblem;
import com.shepherdjerred.thestorm.tracks.app.Quote;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackPurchases;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.IntConsumer;
import java.util.random.RandomGenerator;
import java.util.stream.Collectors;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * Wires the NPCs like the real module, from a content folder the test writes, with fake chunk
 * tickets and a recording dialog presenter (MockBukkit implements neither plugin chunk tickets nor
 * runtime dialogs). Not final: MockBukkit subclasses plugins.
 */
public class NpcsTestPlugin extends JavaPlugin {

  static final Path SHIPPED_CONFIG = Path.of("../../../server/owned/plugins/TheStorm/npcs.yml");

  /** The plugin data folder; the test writes {@code npcs/*.yml} under it before loading. */
  static @Nullable Path directory;

  final List<Shown> shown = new ArrayList<>();
  final List<Player> closed = new ArrayList<>();
  final Set<ChunkKey> tickets = new HashSet<>();
  private @Nullable StormDatabase database;
  private NpcsPaper.@Nullable Installed installed;

  /** A screen shown to a player. */
  record Shown(Player player, Screen screen, IntConsumer onClick) {}

  @Override
  public void onEnable() {
    var data = Objects.requireNonNull(directory, "directory");
    var db = StormDatabase.open(data.resolve("t.db"));
    database = db;
    var config = ConfigFiles.load(SHIPPED_CONFIG, NpcsConfig.class);
    var context =
        new ModuleContext(
            this,
            getLifecycleManager(),
            new PaperScheduler(this),
            db,
            new Services(),
            data,
            InstantSource.system(),
            RandomGenerator.getDefault(),
            getComponentLogger());
    var catalog = new NpcCatalog(load(data));
    var trainer =
        new Trainer(
            new NoPurchases(),
            (player, track) -> 0,
            new TrainerWording(amount -> amount + " crystals", InstantSource.system()),
            context.scheduler().mainThread());
    installed =
        NpcsPaper.install(
            context,
            config,
            new NpcsPaper.Parts(
                catalog,
                new DialogueRegistry(),
                new ActionRegistry(),
                trainer,
                () -> source(data),
                Runnable::run),
            new NpcsPaper.Hooks(new Tickets(), new Presenter()));
  }

  @Override
  public void onDisable() {
    if (installed != null) {
      installed.shutdown().cancel();
    }
    if (database != null) {
      database.close();
    }
  }

  private ContentRules rules() {
    return new ContentRules(
        getServer().getWorlds().stream()
            .map(world -> world.getKey().asString())
            .collect(Collectors.toUnmodifiableSet()),
        Set.of("shopkeeper", "mechanic", "engineer", "spellcaster", "governor"));
  }

  private ContentSource source(Path data) {
    var rules = rules();
    return () -> ContentLoader.load(data, rules);
  }

  private Content load(Path data) {
    return switch (ContentLoader.load(data, rules())) {
      case Result.Ok<Content, List<ContentProblem>>(var content) -> content;
      case Result.Err<Content, List<ContentProblem>>(var problems) ->
          throw new IllegalStateException(problems.toString());
    };
  }

  private final class Tickets implements ChunkTickets {

    @Override
    public void hold(Set<ChunkKey> chunks) {
      tickets.clear();
      tickets.addAll(chunks);
    }
  }

  private final class Presenter implements DialogPresenter {

    @Override
    public void show(Player player, Screen screen, IntConsumer onClick) {
      shown.add(new Shown(player, screen, onClick));
    }

    @Override
    public void close(Player player) {
      closed.add(player);
    }
  }

  /** The trainer is covered by the app tests; here no one can buy anything. */
  private static final class NoPurchases implements TrackPurchases {

    @Override
    public CompletableFuture<Result<Quote, List<PurchaseProblem>>> quote(UUID player, Track track) {
      return CompletableFuture.completedFuture(
          Result.err(List.of(new PurchaseProblem.ShuttingDown())));
    }

    @Override
    public CompletableFuture<
            Result<com.shepherdjerred.thestorm.tracks.app.Purchase, List<PurchaseProblem>>>
        buy(UUID player, Quote quote) {
      return CompletableFuture.completedFuture(
          Result.err(List.of(new PurchaseProblem.ShuttingDown())));
    }
  }
}
