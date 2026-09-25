package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.spells.SpellsModule;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.Objects;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * A stand-in for the real plugin that enables only spells, with the shipped {@code spells.yml}, a
 * database in {@link #directory} and a land-protection port that refuses everything at x >= 1000.
 * Not final: MockBukkit subclasses plugins.
 */
public class SpellsTestPlugin extends JavaPlugin {

  static final Component CLAIMED = Component.text("This land is claimed.");

  /** Where the test wants config and the database; set before MockBukkit loads the plugin. */
  static @Nullable Path directory;

  final Services services = new Services();
  final SpellsModule module = new SpellsModule();
  private @Nullable StormDatabase database;

  @Override
  public void onEnable() {
    var directory = Objects.requireNonNull(SpellsTestPlugin.directory, "directory");
    try {
      Files.copy(
          Path.of(Objects.requireNonNull(System.getProperty("thestorm.spells.config"))),
          directory.resolve("spells.yml"));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    var database = StormDatabase.open(directory.resolve("t.db"));
    this.database = database;
    Protection protection =
        (player, action, location) ->
            location.getX() >= 1000 ? new Decision.Denied(CLAIMED) : Decision.allowed();
    services.provide(Protection.class, protection);
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
    module.enable(context);
  }

  @Override
  public void onDisable() {
    module.disable();
    if (database != null) {
      database.close();
    }
  }
}
