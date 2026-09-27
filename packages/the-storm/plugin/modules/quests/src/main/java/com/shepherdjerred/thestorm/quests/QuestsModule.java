package com.shepherdjerred.thestorm.quests;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.npcs.app.NpcActions;
import com.shepherdjerred.thestorm.npcs.app.NpcDialogs;
import com.shepherdjerred.thestorm.npcs.app.NpcDirectory;
import com.shepherdjerred.thestorm.npcs.app.NpcMarkers;
import com.shepherdjerred.thestorm.npcs.app.NpcRef;
import com.shepherdjerred.thestorm.quests.adapter.content.ContentLoader;
import com.shepherdjerred.thestorm.quests.adapter.db.JooqQuestStore;
import com.shepherdjerred.thestorm.quests.adapter.luckperms.LuckPermsGrants;
import com.shepherdjerred.thestorm.quests.adapter.paper.QuestsPaper;
import com.shepherdjerred.thestorm.quests.adapter.paper.Registries;
import com.shepherdjerred.thestorm.quests.app.QuestHooks;
import com.shepherdjerred.thestorm.quests.app.QuestProgress;
import com.shepherdjerred.thestorm.quests.app.QuestService;
import com.shepherdjerred.thestorm.quests.app.WalletRewards;
import com.shepherdjerred.thestorm.quests.domain.config.QuestsConfig;
import com.shepherdjerred.thestorm.quests.domain.content.ContentCheck;
import com.shepherdjerred.thestorm.quests.domain.content.ContentProblem;
import com.shepherdjerred.thestorm.quests.domain.content.QuestContent;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import java.util.List;
import net.luckperms.api.LuckPermsProvider;
import org.jspecify.annotations.Nullable;

/**
 * Quests, replacing BetonQuest and Quests: content-defined statecharts offered and handed in at
 * NPCs, with reputation, quest points, a radiant daily and weekly board, party credit, a tracking
 * sidebar and a journal. Content is linted at enable and refuses to load if anything is wrong.
 * Publishes {@link QuestHooks} (custom objectives and actions) and {@link QuestProgress}.
 */
public final class QuestsModule implements StormModule {

  private @Nullable Cancellable tick;

  @Override
  public String id() {
    return "quests";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("quests.yml", QuestsConfig.class);
    context.database().migrate(id(), QuestsModule.class.getClassLoader());
    var services = context.services();
    var npcs = services.require(NpcDirectory.class);
    var mainWorld = context.plugin().getServer().getWorld(config.mainWorld());
    if (mainWorld == null) {
      throw new IllegalStateException("Quest main world is not loaded: " + config.mainWorld());
    }
    var rules =
        new ContentCheck.Rules(
            Registries.of(context.plugin().getServer(), npcs),
            config.budget(),
            config.board().npc(),
            mainWorld.getKey().asString());
    var content = requireValid(ContentLoader.load(context.dataDirectory(), rules));
    var paper =
        new QuestsPaper(
            context,
            config,
            new QuestsPaper.Ports(
                services.require(TrackLevels.class),
                services.require(Protection.class),
                npcs,
                services.require(NpcDialogs.class),
                services.require(NpcActions.class),
                services.require(NpcMarkers.class),
                services.require(PlayerDirectory.class)));
    var rewards =
        new WalletRewards(
            services.require(Wallets.class),
            services.require(CrystalFormatter.class),
            new LuckPermsGrants(LuckPermsProvider.get()));
    var service =
        new QuestService(
            new QuestService.Wiring(
                content,
                config,
                new JooqQuestStore(context.database()),
                paper.world(content),
                rewards,
                npc -> npcs.find(npc).map(QuestsModule::shortName).orElse(npc),
                context.scheduler().mainThread(),
                context.time(),
                context.random(),
                context.logger()));
    services.provide(QuestHooks.class, service);
    services.provide(QuestProgress.class, service);
    tick = paper.install(service, paper.dialogJournal(service));
    context
        .logger()
        .info(
            "Loaded {} quests and {} board templates",
            content.quests().size(),
            content.templates().size());
  }

  @Override
  public void disable() {
    if (tick != null) {
      tick.cancel();
      tick = null;
    }
  }

  /** "Thomas" from "Thomas · Blacksmith": NPC names carry their role after a middle dot. */
  static String shortName(NpcRef npc) {
    var dot = npc.name().indexOf(" · ");
    return dot < 0 ? npc.name() : npc.name().substring(0, dot);
  }

  private static QuestContent requireValid(Result<QuestContent, List<ContentProblem>> loaded) {
    return switch (loaded) {
      case Result.Ok<QuestContent, List<ContentProblem>>(var content) -> content;
      case Result.Err<QuestContent, List<ContentProblem>>(var problems) ->
          throw new IllegalStateException(
              "Invalid quest content:\n"
                  + String.join("\n", problems.stream().map(ContentProblem::toString).toList()));
    };
  }
}
