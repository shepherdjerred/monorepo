package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.shops.ShopsModule;
import com.shepherdjerred.thestorm.shops.app.FakeWallets;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.InstantSource;
import java.util.HashSet;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * A stand-in for the real plugin that enables only the shops, with the shipped {@code shops.yml}
 * and catalogs, a real SQLite database, and fakes for the economy and land protection. Not final:
 * MockBukkit subclasses plugins.
 */
public class ShopsTestPlugin extends JavaPlugin {

  static final Path OWNED = Path.of("../../../server/owned/plugins/TheStorm");

  /** Where the test wants config and the database; set before MockBukkit loads the plugin. */
  static @Nullable Path directory;

  final Services services = new Services();
  final FakeWallets wallets = new FakeWallets();
  final TestProtection protection = new TestProtection();
  private @Nullable StormDatabase database;

  /** Land protection that allows everything except what a test denies. */
  static final class TestProtection implements Protection {
    final Set<ProtectedAction> denied = new HashSet<>();
    boolean sameLand = true;

    @Override
    public Decision check(UUID player, ProtectedAction action, Location location) {
      return denied.contains(action)
          ? new Decision.Denied(Component.text("This land belongs to Aegis."))
          : Decision.allowed();
    }

    @Override
    public Decision checkHarm(
        UUID attacker, Location attackerAt, HarmTarget target, Location victimAt) {
      return Decision.allowed();
    }

    @Override
    public boolean sameLand(Location a, Location b) {
      return sameLand;
    }
  }

  StormDatabase database() {
    return Objects.requireNonNull(database, "database");
  }

  @Override
  public void onEnable() {
    var directory = Objects.requireNonNull(ShopsTestPlugin.directory, "directory");
    copy(OWNED.resolve("shops.yml"), directory.resolve("shops.yml"));
    // Tests click faster than players; the cooldown itself is tested in ChestShopsTest.
    rewrite(directory.resolve("shops.yml"), "clickCooldownMillis: 250", "clickCooldownMillis: 0");
    var catalogs = directory.resolve("shops");
    try (var files = Files.list(OWNED.resolve("shops"))) {
      Files.createDirectories(catalogs);
      files.forEach(file -> copy(file, catalogs.resolve(file.getFileName())));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    var database = StormDatabase.open(directory.resolve("t.db"));
    this.database = database;
    services.provide(Wallets.class, wallets);
    services.provide(
        CrystalFormatter.class,
        new CrystalFormatter() {
          @Override
          public String words(Crystals amount) {
            return amount.amount() + (amount.amount() == 1 ? " crystal" : " crystals");
          }

          @Override
          public String symbol(Crystals amount) {
            return amount.amount() + " CR";
          }
        });
    services.provide(Protection.class, protection);
    services.provide(
        PlayerDirectory.class,
        new PlayerDirectory() {
          @Override
          public CompletableFuture<Optional<KnownPlayer>> byName(String name) {
            return CompletableFuture.completedFuture(Optional.empty());
          }

          @Override
          public CompletableFuture<Optional<KnownPlayer>> byId(UUID uuid) {
            return CompletableFuture.completedFuture(Optional.empty());
          }
        });
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
    new ShopsModule().enable(context);
  }

  private static void rewrite(Path file, String from, String to) {
    try {
      var text = Files.readString(file);
      if (!text.contains(from)) {
        throw new IllegalStateException(file + " no longer contains " + from);
      }
      Files.writeString(file, text.replace(from, to));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static void copy(Path from, Path to) {
    try {
      Files.copy(from, to);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @Override
  public void onDisable() {
    if (database != null) {
      database.close();
    }
  }
}
