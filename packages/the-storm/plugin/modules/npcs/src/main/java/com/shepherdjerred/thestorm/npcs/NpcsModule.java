package com.shepherdjerred.thestorm.npcs;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.npcs.adapter.content.ContentLoader;
import com.shepherdjerred.thestorm.npcs.adapter.paper.NpcsPaper;
import com.shepherdjerred.thestorm.npcs.app.ActionRegistry;
import com.shepherdjerred.thestorm.npcs.app.ContentSource;
import com.shepherdjerred.thestorm.npcs.app.DialogueRegistry;
import com.shepherdjerred.thestorm.npcs.app.NpcActions;
import com.shepherdjerred.thestorm.npcs.app.NpcCatalog;
import com.shepherdjerred.thestorm.npcs.app.NpcDialogs;
import com.shepherdjerred.thestorm.npcs.app.NpcDirectory;
import com.shepherdjerred.thestorm.npcs.app.NpcMarkers;
import com.shepherdjerred.thestorm.npcs.app.Trainer;
import com.shepherdjerred.thestorm.npcs.app.TrainerWording;
import com.shepherdjerred.thestorm.npcs.domain.config.NpcsConfig;
import com.shepherdjerred.thestorm.npcs.domain.content.Content;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentProblem;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentRules;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import com.shepherdjerred.thestorm.tracks.app.TrackPurchases;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ForkJoinPool;
import java.util.stream.Collectors;
import org.bukkit.Server;
import org.jspecify.annotations.Nullable;

/**
 * NPCs, replacing Citizens and Sentinel: Mannequins defined as content, reconciled with the world,
 * walked through daily schedules, talking through the Dialog API, training tracks, and carrying
 * per-player quest markers. Publishes {@link NpcDirectory}, {@link NpcDialogs}, {@link NpcActions}
 * and {@link NpcMarkers}.
 */
public final class NpcsModule implements StormModule {

  private @Nullable Cancellable running;

  @Override
  public String id() {
    return "npcs";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("npcs.yml", NpcsConfig.class);
    var server = context.plugin().getServer();
    var dataDirectory = context.dataDirectory();
    var content = requireValid(ContentLoader.load(dataDirectory, rules(server)));
    var catalog = new NpcCatalog(content);
    var dialogues = new DialogueRegistry();
    var actions = new ActionRegistry();
    var formatter = context.services().require(CrystalFormatter.class);
    var trainer =
        new Trainer(
            context.services().require(TrackPurchases.class),
            context.services().require(TrackLevels.class),
            new TrainerWording(amount -> formatter.words(Crystals.of(amount)), context.time()),
            context.scheduler().mainThread());
    var installed =
        NpcsPaper.install(
            context,
            config,
            new NpcsPaper.Parts(
                catalog,
                dialogues,
                actions,
                trainer,
                () -> source(dataDirectory, rules(server)),
                ForkJoinPool.commonPool()),
            NpcsPaper.Hooks.paper(context, config));
    running = installed.shutdown();
    context.services().provide(NpcDirectory.class, catalog);
    context.services().provide(NpcDialogs.class, dialogues);
    context.services().provide(NpcActions.class, actions);
    context.services().provide(NpcMarkers.class, installed.markers());
    // Modules after this one register their actions during enable; check once they all have.
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              var missing = actions.missing(catalog.content().dialogues().values());
              if (!missing.isEmpty()) {
                context
                    .logger()
                    .error("NPC dialogues use actions no module registered: {}", missing);
              }
            });
  }

  @Override
  public void disable() {
    if (running != null) {
      running.cancel();
      running = null;
    }
  }

  /** What content must agree with: the loaded worlds and the tracks a trainer may teach. */
  static ContentRules rules(Server server) {
    return new ContentRules(
        server.getWorlds().stream()
            .map(world -> world.getKey().asString())
            .collect(Collectors.toUnmodifiableSet()),
        Arrays.stream(Track.values()).map(Track::id).collect(Collectors.toUnmodifiableSet()));
  }

  private static ContentSource source(Path dataDirectory, ContentRules rules) {
    return () -> ContentLoader.load(dataDirectory, rules);
  }

  private static Content requireValid(Result<Content, List<ContentProblem>> loaded) {
    return switch (loaded) {
      case Result.Ok<Content, List<ContentProblem>>(var content) -> content;
      case Result.Err<Content, List<ContentProblem>>(var problems) ->
          throw new IllegalStateException(
              "Invalid NPC content:\n"
                  + String.join("\n", problems.stream().map(ContentProblem::toString).toList()));
    };
  }
}
