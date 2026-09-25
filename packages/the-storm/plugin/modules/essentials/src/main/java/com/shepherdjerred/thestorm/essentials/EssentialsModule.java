package com.shepherdjerred.thestorm.essentials;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqBackStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqHomeStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqKitClaimStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqModerationLogStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqPlayerStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqTeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqWarpStore;
import com.shepherdjerred.thestorm.essentials.adapter.paper.EssentialsPaper;
import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.essentials.app.PlayerDirectory;
import com.shepherdjerred.thestorm.essentials.app.TeleportGuards;
import com.shepherdjerred.thestorm.essentials.app.TeleportPayments;
import com.shepherdjerred.thestorm.essentials.app.WarpDirectory;
import com.shepherdjerred.thestorm.essentials.domain.config.EssentialsConfig;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricer;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.jspecify.annotations.Nullable;

/**
 * Spawn, homes, {@code /tpa}, {@code /back}, warps, kits, the rules book, AFK and kicks and bans:
 * The Storm's replacement for EssentialsX and LiteBans. Teleports are paid in crystals through the
 * economy module, which must be enabled first.
 *
 * <p>Publishes {@link TeleportGuards} (other modules add rules such as "not in combat") and {@link
 * AfkStatus}.
 */
public final class EssentialsModule implements StormModule {

  private @Nullable EssentialsPaper paper;

  @Override
  public String id() {
    return "essentials";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("essentials.yml", EssentialsConfig.class);
    context.database().migrate(id(), getClass().getClassLoader());
    var database = context.database();
    var wallets = context.services().require(Wallets.class);

    var guards = new GuardRegistry();
    var afk = new AfkTracker(context.time(), config.afkTimeout());
    context.services().provide(TeleportGuards.class, guards);
    context.services().provide(AfkStatus.class, afk);

    var moderation = ModerationService.load(new JooqModerationLogStore(database), context.time());
    var players = PlayerDirectory.load(new JooqPlayerStore(database));
    var warps = WarpDirectory.load(new JooqWarpStore(database));
    logLoad(context, moderation.loaded(), "the moderation log");
    logLoad(context, players.loaded(), "known players");
    logLoad(context, warps.loaded(), "warps");

    var payments =
        new TeleportPayments(
            new TeleportPricer(config.teleports().pricing()),
            new JooqTeleportUsageStore(database),
            wallets,
            context.time());
    var stores =
        new EssentialsPaper.Stores(
            new JooqHomeStore(database),
            new JooqBackStore(database),
            new JooqKitClaimStore(database));
    paper =
        EssentialsPaper.start(
            context,
            config,
            new EssentialsPaper.App(payments, guards, afk, moderation, players, warps, stores));
  }

  @Override
  public void disable() {
    if (paper != null) {
      paper.stop();
      paper = null;
    }
  }

  private static void logLoad(ModuleContext context, CompletableFuture<Void> load, String what) {
    var _ =
        load.whenComplete(
            (done, failure) -> {
              if (failure != null) {
                context
                    .logger()
                    .error(Component.text("essentials could not load " + what), failure);
              }
            });
  }
}
