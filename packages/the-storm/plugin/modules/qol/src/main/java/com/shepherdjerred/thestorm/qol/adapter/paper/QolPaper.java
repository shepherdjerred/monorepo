package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.core.world.BlockChanges;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.app.AfkStatus;
import com.shepherdjerred.thestorm.essentials.app.TeleportGuards;
import com.shepherdjerred.thestorm.qol.app.BankBook;
import com.shepherdjerred.thestorm.qol.app.CombatTracker;
import com.shepherdjerred.thestorm.qol.app.GraveRegistry;
import com.shepherdjerred.thestorm.qol.app.SortBook;
import com.shepherdjerred.thestorm.qol.app.store.BankStore;
import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.app.store.SortStore;
import com.shepherdjerred.thestorm.qol.domain.config.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement;
import com.shepherdjerred.thestorm.qol.domain.sort.CategoryCatalog;
import com.shepherdjerred.thestorm.qol.domain.sort.SortSwitches;
import com.shepherdjerred.thestorm.qol.domain.text.DurationText;
import io.papermc.paper.plugin.lifecycle.event.types.LifecycleEvents;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;

/**
 * Wires qol into Paper: listeners, commands, permissions, periodic checks and the teleport guard.
 */
public final class QolPaper {

  private static final Duration EVERY_SECOND = Duration.ofSeconds(1);

  private final List<Listener> listeners = new ArrayList<>();
  private final List<Cancellable> tasks = new ArrayList<>();
  private final QolPermissions permissions;
  private final CombatTracker combat;
  private final SleepListener sleep;
  private final BankBook banks;
  private final SortBook sorts;
  private final ComponentLogger logger;
  private boolean stopped;

  private QolPaper(
      QolPermissions permissions,
      CombatTracker combat,
      SleepListener sleep,
      BankBook banks,
      SortBook sorts,
      ComponentLogger logger) {
    this.permissions = permissions;
    this.combat = combat;
    this.sleep = sleep;
    this.banks = banks;
    this.sorts = sorts;
    this.logger = logger;
  }

  /**
   * What qol works with.
   *
   * @param store grave storage
   * @param graves the graves in memory
   * @param combat combat tags
   * @param protection land protection, for grave spots and chest sorting
   * @param guards essentials' teleport guards, for the combat guard
   * @param afk essentials' away status, for the sleep vote
   * @param sealed worlds the graves stay out of
   * @param banks deposit bank storage
   * @param sorts per-player sort switches
   */
  public record App(
      GraveStore store,
      GraveRegistry graves,
      CombatTracker combat,
      Protection protection,
      TeleportGuards guards,
      AfkStatus afk,
      SealedWorlds sealed,
      BankStore banks,
      SortStore sorts) {}

  /** Categories plus the server calls used while the module is starting. */
  record Boot(CategoryCatalog categories, ServerHooks hooks) {}

  public static QolPaper start(
      ModuleContext context, QolConfig config, App app, CategoryCatalog categories) {
    return start(context, config, app, new Boot(categories, ServerHooks.PAPER));
  }

  /** {@link #start(ModuleContext, QolConfig, App, CategoryCatalog)} with the given server calls. */
  static QolPaper start(ModuleContext context, QolConfig config, App app, Boot boot) {
    var categories = boot.categories();
    var hooks = boot.hooks();
    InventorySorter.use(categories);
    var server = context.plugin().getServer();
    var runtime = new QolRuntime(server, context.scheduler(), context.time(), context.logger());
    var permissions = new QolPermissions(server.getPluginManager());
    permissions.register(config.bank().groups().keySet());

    var policy = config.graves().policy();
    var parts =
        new GraveParts(
            app.store(),
            app.graves(),
            new GravePlacement(config.graves().searchRadius()),
            policy,
            app.protection(),
            hooks,
            app.sealed(),
            context.services().require(BlockChanges.class));
    var safe = new LastSafeSpots();
    var upkeep = new GraveUpkeep(runtime, parts);
    var deaths = new GraveDeaths(runtime, parts, safe, context.random());
    var opening = new GraveOpening(runtime, parts, upkeep, context.random());
    var sorting = new ContainerSorting(app.protection());
    var combat = new CombatListener(runtime, app.combat(), config.combat(), app.sealed());
    var sleep = new SleepListener(runtime, app.afk(), config.sleep().percent());
    var banks = new BankBook();
    var bankListener =
        new Banks(
            new Banks.Gear(
                runtime, banks, app.banks(), config.bank(), app.protection(), context.services()));
    var sorts = new SortBook(SortSwitches.defaults(config.sort().defaults()));
    var sortBehavior =
        new SortBehavior(
            new SortBehavior.Wiring(runtime, sorts, app.sorts(), config.sort(), sorting));
    var paper = new QolPaper(permissions, app.combat(), sleep, banks, sorts, context.logger());

    app.guards()
        .add(
            (mover, destination) ->
                app.combat()
                    .remaining(mover)
                    .map(
                        remaining ->
                            HouseStyle.error(
                                Say.COMBAT,
                                Component.text(
                                    "You cannot teleport while in combat ("
                                        + DurationText.of(remaining)
                                        + " left)."))));

    var commands = new QolCommands(runtime, app.graves(), policy);
    var bankCommands = new BankCommands(bankListener);
    var sortCommands = new SortCommands(sortBehavior);
    context
        .lifecycle()
        .registerEventHandler(
            LifecycleEvents.COMMANDS,
            event -> {
              commands.register(event.registrar());
              bankCommands.register(event.registrar());
              sortCommands.register(event.registrar());
            });

    paper.listeners.add(new GraveListener(deaths, opening, upkeep, safe));
    paper.listeners.add(new GraveShield());
    paper.listeners.add(combat);
    paper.listeners.add(sleep);
    if (config.sort().sneakPunch()) {
      paper.listeners.add(new SortListener(sorting));
    }
    paper.listeners.add(bankListener);
    paper.listeners.add(sortBehavior);
    paper.listeners.forEach(
        listener -> server.getPluginManager().registerEvents(listener, context.plugin()));
    sleep.start();

    var scheduler = context.scheduler();
    paper.tasks.addAll(
        List.of(
            scheduler.repeatOnMainThread(
                EVERY_SECOND, EVERY_SECOND, () -> server.getOnlinePlayers().forEach(safe::sample)),
            scheduler.repeatOnMainThread(EVERY_SECOND, EVERY_SECOND, combat::tick),
            scheduler.repeatOnMainThread(EVERY_SECOND, EVERY_SECOND, sleep::tick),
            scheduler.repeatOnMainThread(
                Duration.ofMinutes(1), Duration.ofMinutes(1), bankListener::sweep)));
    upkeep.load(
        paper::gravesUnreadable,
        () ->
            server
                .getOnlinePlayers()
                .forEach(
                    player -> {
                      deaths.recover(player);
                      opening.recover(player);
                      upkeep.expireNear(player);
                      opening.nearby(player);
                    }));
    runtime.onMain(
        app.banks().loadAll(),
        "load banks",
        loaded -> {
          if (!paper.stopped) {
            banks.load(loaded);
          }
        },
        failure -> {
          if (!paper.stopped) {
            paper.banksUnreadable();
          }
        });
    runtime.onMain(
        app.sorts().loadAll(),
        "load sort settings",
        loaded -> {
          if (!paper.stopped) {
            sorts.load(loaded);
          }
        },
        failure -> {
          if (!paper.stopped) {
            paper.sortsUnreadable();
          }
        });
    return paper;
  }

  BankBook banks() {
    return banks;
  }

  SortBook sorts() {
    return sorts;
  }

  /** Sort settings could not be read: qol stops rather than guess who wants automatic sorting. */
  private void sortsUnreadable() {
    logger.error(
        Component.text(
            "qol stopped: sort settings could not be loaded from storage. Sorting stays unused"
                + " until the server restarts with working storage."));
    stop();
  }

  /** Banks could not be read: qol stops rather than shelve from a partial picture. */
  private void banksUnreadable() {
    logger.error(
        Component.text(
            "qol stopped: banks could not be loaded from storage. Deposit banks stay unused until"
                + " the server restarts with working storage."));
    stop();
  }

  /** Graves could not be read: qol stops rather than run graves on a partial picture. */
  private void gravesUnreadable() {
    logger.error(
        Component.text(
            "qol stopped: graves could not be loaded from storage. Deaths drop items as vanilla"
                + " until the server restarts with working storage."));
    stop();
  }

  /**
   * Stops everything started here except commands, which Paper keeps until shutdown, and the
   * teleport guard, which cannot be removed and allows every teleport once the tags are cleared.
   */
  public void stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    tasks.forEach(Cancellable::cancel);
    listeners.forEach(HandlerList::unregisterAll);
    permissions.unregister();
    combat.clearAll();
    sleep.stop();
  }
}
