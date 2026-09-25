package com.shepherdjerred.thestorm.arena;

import com.shepherdjerred.thestorm.arena.adapter.content.ContentFiles;
import com.shepherdjerred.thestorm.arena.adapter.db.JooqLeaderboardStore;
import com.shepherdjerred.thestorm.arena.adapter.db.JooqRewardStore;
import com.shepherdjerred.thestorm.arena.adapter.db.JooqSnapshotStore;
import com.shepherdjerred.thestorm.arena.adapter.paper.ArenaPaper;
import com.shepherdjerred.thestorm.arena.adapter.paper.ChunkKeeper;
import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.arena.app.ArenaRecords;
import com.shepherdjerred.thestorm.arena.app.RewardPayer;
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

  private final Function<ModuleContext, ChunkKeeper> chunks;
  private @Nullable ArenaPaper paper;

  /** Arena chunks are held through core's shared {@link ChunkTickets}. */
  public ArenaModule() {
    this(context -> ChunkKeeper.shared(context.services().require(ChunkTickets.class)));
  }

  /** For tests, which run where plugin chunk tickets are not available. */
  ArenaModule(Function<ModuleContext, ChunkKeeper> chunks) {
    this.chunks = chunks;
  }

  @Override
  public String id() {
    return "arena";
  }

  @Override
  public void enable(ModuleContext context) {
    var content = ContentFiles.load(context.dataDirectory());
    context.database().migrate(id(), getClass().getClassLoader());
    var database = context.database();
    var leaderboard = new JooqLeaderboardStore(database);
    var app =
        new ArenaPaper.App(
            new JooqSnapshotStore(database),
            new JooqRewardStore(database),
            leaderboard,
            new RewardPayer(context.services().require(Wallets.class)),
            context.services().require(CrystalFormatter.class));
    var started = ArenaPaper.start(context, content, app, chunks.apply(context));
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
  }
}
