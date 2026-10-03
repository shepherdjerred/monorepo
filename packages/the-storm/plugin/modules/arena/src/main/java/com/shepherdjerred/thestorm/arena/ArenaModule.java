package com.shepherdjerred.thestorm.arena;

import com.shepherdjerred.thestorm.arena.adapter.content.ContentFiles;
import com.shepherdjerred.thestorm.arena.adapter.db.JooqLeaderboardStore;
import com.shepherdjerred.thestorm.arena.adapter.db.JooqRewardStore;
import com.shepherdjerred.thestorm.arena.adapter.db.JooqSnapshotStore;
import com.shepherdjerred.thestorm.arena.adapter.db.JooqSurvivalProgress;
import com.shepherdjerred.thestorm.arena.adapter.paper.ArenaPaper;
import com.shepherdjerred.thestorm.arena.adapter.paper.ChunkKeeper;
import com.shepherdjerred.thestorm.arena.adapter.paper.ServerHooks;
import com.shepherdjerred.thestorm.arena.adapter.remote.FliptSurvivalGate;
import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.arena.app.ArenaRecords;
import com.shepherdjerred.thestorm.arena.app.RewardPayer;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The Mob Arena, replacing MobArena: 72 waves with bosses, swarms, cavalry and upgrades, classes,
 * crystal rewards and vault bonuses, and a best-wave leaderboard. Arenas, waves and classes are
 * content under {@code plugins/TheStorm/arena}. Rewards are paid through the economy module, which
 * must be enabled first.
 *
 * <p>Publishes {@link ArenaPresence} (who is in an arena) and {@link ArenaRecords} (best waves).
 */
public final class ArenaModule implements StormModule {

  private final Function<ModuleContext, ServerHooks> hooks;
  private @Nullable ArenaPaper paper;
  private @Nullable FliptSurvivalGate gate;

  /** Arena chunks are held through core's shared {@link ChunkTickets}. */
  public ArenaModule() {
    this(
        context ->
            new ServerHooks(ChunkKeeper.shared(context.services().require(ChunkTickets.class))));
  }

  /** For tests, which run where chunk tickets are not available. */
  ArenaModule(Function<ModuleContext, ServerHooks> hooks) {
    this.hooks = hooks;
  }

  @Override
  public String id() {
    return "arena";
  }

  @Override
  public void enable(ModuleContext context) {
    var content = ContentFiles.load(context.dataDirectory());
    var survival =
        ConfigFiles.load(
            context.dataDirectory().resolve("arena/survival.yml"), SurvivalContent.class);
    context.database().migrate(id(), getClass().getClassLoader());
    var database = context.database();
    var leaderboard = new JooqLeaderboardStore(database);
    com.shepherdjerred.thestorm.arena.app.SurvivalGate rollout;
    var flipt = System.getenv("FLIPT_URL");
    var environment = System.getenv("FLIPT_ENVIRONMENT");
    if (flipt == null || flipt.isBlank() || environment == null || environment.isBlank()) {
      rollout = _ -> java.util.concurrent.CompletableFuture.completedFuture(false);
    } else {
      var remote =
          new com.shepherdjerred.thestorm.arena.adapter.remote.FliptSurvivalGate(
              java.net.URI.create(flipt), environment);
      gate = remote;
      rollout = remote;
    }
    var app =
        new ArenaPaper.App(
            new JooqSnapshotStore(database),
            new JooqRewardStore(database),
            leaderboard,
            new RewardPayer(context.services().require(Wallets.class)),
            context.services().require(CrystalFormatter.class),
            new JooqSurvivalProgress(database),
            rollout,
            new com.shepherdjerred.thestorm.arena.adapter.db.JooqSettlementStore(database));
    var started =
        ArenaPaper.start(
            context, new ArenaPaper.Content(content, survival), app, hooks.apply(context));
    paper = started;
    context.services().provide(ArenaPresence.class, started.presence());
    context.services().provide(ArenaRecords.class, leaderboard);
  }

  @Override
  public void disable() {
    if (paper != null) {
      paper.stop();
      paper = null;
    }
    if (gate != null) {
      gate.close();
      gate = null;
    }
  }
}
