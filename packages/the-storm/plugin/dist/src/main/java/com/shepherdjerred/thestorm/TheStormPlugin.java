package com.shepherdjerred.thestorm;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.ModuleRegistry;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.players.SqlPlayerDirectory;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * The Storm. Reads the repository-owned {@code config.yml}, opens the database and enables the
 * configured modules. A bad config stops the plugin: it never falls back to defaults.
 */
public final class TheStormPlugin extends JavaPlugin {

  private final List<StormModule> enabled = new ArrayList<>();
  private final Services services = new Services();
  private @Nullable StormDatabase database;

  /**
   * Enables The Storm or stops the server. Once modules replace third-party plugins (land
   * protection, bans, the economy), running without them is worse than not running: a server with
   * the plugin disabled would let players join with no land protection. So any enable failure is
   * logged and the server is shut down, which keeps the failure loud (the pod restarts and alerts)
   * instead of quietly failing open.
   */
  @Override
  public void onEnable() {
    try {
      enableModules();
    } catch (RuntimeException e) {
      getComponentLogger()
          .error("The Storm failed to enable; stopping the server rather than run unprotected", e);
      getServer().shutdown();
      throw e;
    }
  }

  private void enableModules() {
    var config = readConfig();
    var selected =
        switch (ModuleRegistry.select(Modules.all(), config.toggles())) {
          case Result.Ok<List<StormModule>, List<String>>(var modules) -> modules;
          case Result.Err<List<StormModule>, List<String>>(var problems) ->
              throw new IllegalStateException("Invalid config.yml: " + String.join("; ", problems));
        };
    try {
      Files.createDirectories(getDataPath());
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    var db = StormDatabase.open(getDataPath().resolve("the-storm.db"));
    database = db;
    db.migrate("core", getClass().getClassLoader());
    var players = new SqlPlayerDirectory(db);
    services.provide(PlayerDirectory.class, players);
    services.provide(ChunkTickets.class, new ChunkTickets(this));
    getServer()
        .getPluginManager()
        .registerEvents(
            new PlayerDirectoryListener(players, InstantSource.system(), getComponentLogger()),
            this);
    var context =
        new ModuleContext(
            this,
            getLifecycleManager(),
            new PaperScheduler(this),
            db,
            services,
            getDataPath(),
            InstantSource.system(),
            RandomGenerator.getDefault(),
            getComponentLogger());
    for (var module : selected) {
      module.enable(context);
      enabled.add(module);
    }
    getComponentLogger().info("Enabled modules: {}", ModuleRegistry.ids(selected));
  }

  @Override
  public void onDisable() {
    for (var module : enabled.reversed()) {
      module.disable();
    }
    enabled.clear();
    services.clear();
    if (database != null) {
      database.close();
      database = null;
    }
  }

  private PluginConfig readConfig() {
    var file = getDataPath().resolve("config.yml");
    String yaml;
    try {
      yaml = Files.readString(file);
    } catch (IOException e) {
      throw new UncheckedIOException("TheStorm requires " + file + " (owned by the repo)", e);
    }
    return switch (StrictYaml.parse(file.toString(), yaml, PluginConfig.class)) {
      case Result.Ok<PluginConfig, List<Problem>>(var value) -> value;
      case Result.Err<PluginConfig, List<Problem>>(var problems) ->
          throw new IllegalStateException(
              "Invalid config.yml: "
                  + String.join("; ", problems.stream().map(Problem::toString).toList()));
    };
  }
}
