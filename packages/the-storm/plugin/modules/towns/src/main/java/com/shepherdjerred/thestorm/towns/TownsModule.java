package com.shepherdjerred.thestorm.towns;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqTownsStore;
import com.shepherdjerred.thestorm.towns.adapter.paper.TownsPaper;
import com.shepherdjerred.thestorm.towns.app.Clocks;
import com.shepherdjerred.thestorm.towns.app.TownService;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import com.shepherdjerred.thestorm.towns.domain.TownsConfig;
import com.shepherdjerred.thestorm.towns.domain.claiming.Claiming;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Towns, claims, admin regions and the land-protection engine. Publishes {@link Protection} for
 * every other module.
 *
 * <p>Claims are loaded before any listener is registered and before the port is published, so there
 * is no moment after enable when claimed land is unprotected. Enable waits for that load: it runs
 * once at startup, before players can join.
 */
public final class TownsModule implements StormModule {

  /** How long enable waits for the stored towns before failing the module. */
  private static final long LOAD_TIMEOUT_SECONDS = 30;

  @Override
  public String id() {
    return "towns";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("towns.yml", TownsConfig.class);
    context.database().migrate(id(), TownsModule.class.getClassLoader());
    var store = new JooqTownsStore(context.database());
    var state = new TownsState(new RegionIndex(config.regions()));
    try {
      state.load(store.loadAll().get(LOAD_TIMEOUT_SECONDS, TimeUnit.SECONDS));
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("interrupted while loading towns", e);
    } catch (ExecutionException | TimeoutException e) {
      throw new IllegalStateException("could not load towns", e);
    }
    var towns =
        new TownService(
            state,
            store,
            new Claiming(config.claims()),
            new Clocks(
                context.time(),
                context.random(),
                context.scheduler().mainThread(),
                failure ->
                    context
                        .logger()
                        .error(
                            "Towns could not be reloaded after a failed save; changes are"
                                + " refused until the server restarts",
                            failure)));
    var protection = TownsPaper.install(context, state, towns, config);
    context.services().provide(Protection.class, protection);
    context
        .logger()
        .info(
            "{} towns and {} admin regions loaded", state.towns().size(), config.regions().size());
  }
}
