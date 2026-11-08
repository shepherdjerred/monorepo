package com.shepherdjerred.thestorm.skytravel;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry;
import com.shepherdjerred.thestorm.skytravel.adapter.bluemap.BlueMapTowers;
import com.shepherdjerred.thestorm.skytravel.adapter.db.JooqFlightStore;
import com.shepherdjerred.thestorm.skytravel.adapter.grim.GrimFlightChecks;
import com.shepherdjerred.thestorm.skytravel.adapter.paper.LaunchFlights;
import com.shepherdjerred.thestorm.skytravel.app.FlightChecks;
import com.shepherdjerred.thestorm.skytravel.domain.LaunchConfig;
import org.jspecify.annotations.Nullable;

/** Public Skylands beacons. Follows qol so combat restrictions cannot be bypassed. */
public final class SkytravelModule implements StormModule {
  private @Nullable LaunchFlights flights;
  private @Nullable BlueMapTowers map;

  @Override
  public String id() {
    return "skytravel";
  }

  @Override
  public void enable(ModuleContext context) {
    var config = context.loadConfig("skytravel.json", LaunchConfig.class);
    var world = context.plugin().getServer().getWorld(config.world());
    if (world == null) throw new IllegalStateException("Skylands launch world is not loaded");
    context.database().migrate(id(), getClass().getClassLoader());
    var checks =
        context.plugin().getServer().getPluginManager().getPlugin("GrimAC") == null
            ? FlightChecks.absent()
            : new GrimFlightChecks();
    var runtime =
        new LaunchFlights(context, config, new JooqFlightStore(context.database()), checks);
    flights = runtime;
    context.services().require(PlayerResetRegistry.class).register(id(), runtime::reset);
    runtime.start();
    if (context.plugin().getServer().getPluginManager().getPlugin("BlueMap") != null) {
      var markers = new BlueMapTowers(world, config);
      map = markers;
      markers.start(context.scheduler());
    }
  }

  @Override
  public void disable() {
    var runtime = flights;
    if (runtime != null) runtime.stop();
    var markers = map;
    if (markers != null) markers.stop();
  }
}
