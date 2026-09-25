package com.shepherdjerred.thestorm.economy.adapter.paper;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.economy.EconomyModule;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.Objects;
import java.util.random.RandomGenerator;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * A stand-in for the real plugin that enables only the economy, with the shipped {@code
 * economy.yml} and a database in {@link #directory}. Not final: MockBukkit subclasses plugins.
 */
public class EconomyTestPlugin extends JavaPlugin {

  static final Path SHIPPED_CONFIG = Path.of("../../../server/owned/plugins/TheStorm/economy.yml");

  /** Where the test wants config and the database; set before MockBukkit loads the plugin. */
  static @Nullable Path directory;

  final Services services = new Services();
  private @Nullable StormDatabase database;

  @Override
  public void onEnable() {
    var directory = Objects.requireNonNull(EconomyTestPlugin.directory, "directory");
    try {
      Files.copy(SHIPPED_CONFIG, directory.resolve("economy.yml"));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    var database = StormDatabase.open(directory.resolve("t.db"));
    this.database = database;
    var context =
        new ModuleContext(
            this,
            getLifecycleManager(),
            new PaperScheduler(this),
            database,
            services,
            directory,
            InstantSource.system(),
            RandomGenerator.getDefault(),
            getComponentLogger());
    new EconomyModule().enable(context);
  }

  @Override
  public void onDisable() {
    if (database != null) {
      database.close();
    }
  }
}
