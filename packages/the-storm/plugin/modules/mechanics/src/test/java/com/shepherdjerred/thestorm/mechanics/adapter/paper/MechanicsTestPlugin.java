package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.mechanics.MechanicsModule;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.Objects;
import java.util.UUID;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * A stand-in for the real plugin that enables only mechanics, with the shipped {@code
 * mechanics.yml} and a fake land protection that denies building wherever x is negative. Not final:
 * MockBukkit subclasses plugins.
 */
public class MechanicsTestPlugin extends JavaPlugin {

  static final Path SHIPPED_CONFIG =
      Path.of("../../../server/owned/plugins/TheStorm/mechanics.yml");

  static final Component DENIED = Component.text("This land belongs to Aegis.");

  /** Where the test wants config and the database; set before MockBukkit loads the plugin. */
  static @Nullable Path directory;

  final Services services = new Services();
  private @Nullable StormDatabase database;

  @Override
  public void onEnable() {
    var directory = Objects.requireNonNull(MechanicsTestPlugin.directory, "directory");
    try {
      Files.copy(SHIPPED_CONFIG, directory.resolve("mechanics.yml"));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    var database = StormDatabase.open(directory.resolve("t.db"));
    this.database = database;
    var protection =
        new Protection() {
          @Override
          public Decision check(UUID player, ProtectedAction action, Location location) {
            return location.getBlockX() < 0 ? new Decision.Denied(DENIED) : Decision.allowed();
          }

          @Override
          public Decision checkHarm(
              UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
            return victimAt.getBlockX() < 0 ? new Decision.Denied(DENIED) : Decision.allowed();
          }
        };
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
    new MechanicsModule().enable(context);
  }

  @Override
  public void onDisable() {
    if (database != null) {
      database.close();
    }
  }
}
