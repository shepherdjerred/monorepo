package com.shepherdjerred.thestorm.essentials;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqBackStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqHomeStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqKitClaimStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqModerationLogStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqPlayerStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqTeleportAttemptStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqTeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqWarpStore;
import com.shepherdjerred.thestorm.essentials.adapter.files.SavedRespawn;
import com.shepherdjerred.thestorm.essentials.adapter.paper.EssentialsPaper;
import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import com.shepherdjerred.thestorm.essentials.app.GuardRegistry;
import com.shepherdjerred.thestorm.essentials.app.HomeSignals;
import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.essentials.app.PlayerDirectory;
import com.shepherdjerred.thestorm.essentials.app.TeleportGuards;
import com.shepherdjerred.thestorm.essentials.app.TeleportPayments;
import com.shepherdjerred.thestorm.essentials.app.WarpDirectory;
import com.shepherdjerred.thestorm.essentials.app.store.HomeStore;
import com.shepherdjerred.thestorm.essentials.domain.config.EssentialsConfig;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricer;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;
import net.kyori.adventure.text.Component;
import org.jspecify.annotations.Nullable;

/**
 * Spawn, homes, {@code /tpa}, {@code /back}, warps, kits, the rules book, AFK and kicks and bans:
 * The Storm's replacement for EssentialsX and LiteBans. Teleports are paid in crystals through the
 * economy module and checked against land protection from the towns module; both must be enabled
 * first.
 *
 * <p>Publishes {@link TeleportGuards} (other modules add rules such as "not in combat"), {@link
 * AfkStatus}, {@link HomeStore} and {@link HomeSignals}.
 */
public final class EssentialsModule implements StormModule {

  private final Function<ModuleContext, Path> levelDirectory;
  private @Nullable EssentialsPaper paper;

  public EssentialsModule() {
    this(context -> context.plugin().getServer().getLevelDirectory());
  }

  /** The level directory is supplied at composition time, before asynchronous file discovery. */
  public EssentialsModule(Function<ModuleContext, Path> levelDirectory) {
    this.levelDirectory = levelDirectory;
  }

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
    var protection = context.services().require(Protection.class);
    var sealed = context.services().require(SealedWorlds.class);

    var guards = new GuardRegistry();
    var afk = new AfkTracker(context.time(), config.afkTimeout(), context.analytics());
    context.services().provide(TeleportGuards.class, guards);
    context.services().provide(AfkStatus.class, afk);
    context.services().provide(com.shepherdjerred.thestorm.essentials.app.ActivityFeed.class, afk);

    var moderation = ModerationService.load(new JooqModerationLogStore(database), context.time());
    context.services().provide(ModerationService.class, moderation);
    var players = PlayerDirectory.load(new JooqPlayerStore(database));
    var staff =
        new com.shepherdjerred.thestorm.essentials.app.StaffState(
            new com.shepherdjerred.thestorm.essentials.adapter.db.JooqStaffStore(database));
    context.services().provide(com.shepherdjerred.thestorm.essentials.app.StaffState.class, staff);
    var reset = new com.shepherdjerred.thestorm.essentials.adapter.db.JooqPlayerReset(database);
    context
        .services()
        .require(com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry.class)
        .register(
            id(),
            player ->
                reset
                    .reset(player)
                    .thenRun(
                        () -> {
                          moderation.forget(player);
                          players.forget(player);
                          staff.forget(player.toString());
                        }));
    context
        .services()
        .provide(
            com.shepherdjerred.thestorm.essentials.app.RuntimeDestinations.class,
            new com.shepherdjerred.thestorm.essentials.app.RuntimeDestinations(
                staff, config.spawn()));
    var warps = WarpDirectory.load(new JooqWarpStore(database));
    logLoad(context, moderation.loaded(), "the moderation log");
    logLoad(context, players.loaded(), "known players");
    logLoad(context, warps.loaded(), "warps");

    var payments =
        new TeleportPayments(
            new TeleportPricer(config.teleports().pricing()),
            new TeleportPayments.Stores(
                new JooqTeleportUsageStore(database), new JooqTeleportAttemptStore(database)),
            wallets,
            context.time());
    logLoad(context, payments.loaded(), "pending teleport charges");
    var stores =
        new EssentialsPaper.Stores(
            new JooqHomeStore(database),
            new JooqBackStore(database),
            new JooqKitClaimStore(database));
    var homeSignals = new HomeSignals();
    context.services().provide(HomeStore.class, stores.homes());
    context.services().provide(HomeSignals.class, homeSignals);
    paper =
        EssentialsPaper.start(
            context,
            config,
            new EssentialsPaper.App(
                payments,
                guards,
                afk,
                moderation,
                players,
                warps,
                stores,
                protection,
                sealed,
                SavedRespawn.load(levelDirectory.apply(context), context.compute())),
            homeSignals);
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
