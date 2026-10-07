package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.expansion.ExpansionSettings;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.economy.app.CrystalFormatter;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.TownsModule;
import com.shepherdjerred.thestorm.towns.app.FakeWallets;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.random.RandomGenerator;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.jspecify.annotations.Nullable;

/**
 * A stand-in for the real plugin that enables only towns, with the shipped {@code towns.yml} plus
 * synthetic admin regions, a database in {@link #directory}, and in-memory stand-ins for the ports
 * towns needs from other modules: wallets, crystal formatting, track levels and the player
 * directory. Not final: MockBukkit subclasses plugins.
 */
public class TownsTestPlugin extends JavaPlugin {

  static final Path SHIPPED_CONFIG = Path.of("../../../server/owned/plugins/TheStorm/towns.yml");
  private static final Path TEST_REGIONS = Path.of("src/test/resources/admin-regions.yml");

  /** Where the test wants config and the database; set before MockBukkit loads the plugin. */
  static @Nullable Path directory;

  final Services services = new Services();
  final FakeWallets wallets = new FakeWallets();

  /** Worlds the test seals; towns must protect nothing there. */
  final SealedWorlds sealed = new SealedWorlds();

  /** Governor levels by player, as the tracks module would report them. */
  final Map<UUID, Integer> governor = new HashMap<>();

  /** Everyone who has "joined", by lowercase name. */
  final Map<String, KnownPlayer> known = new HashMap<>();

  private @Nullable StormDatabase database;

  /** Records {@code name} as having joined, for the player directory. */
  void know(UUID id, String name) {
    known.put(name.toLowerCase(Locale.ROOT), new KnownPlayer(id, name, Instant.EPOCH));
  }

  @Override
  public void onEnable() {
    var directory = Objects.requireNonNull(TownsTestPlugin.directory, "directory");
    try {
      var shipped = Files.readString(SHIPPED_CONFIG);
      var regions = shipped.indexOf("\nregions:");
      if (regions < 0) {
        throw new IllegalStateException("shipped towns config has no regions section");
      }
      Files.writeString(
          directory.resolve("towns.yml"),
          shipped.substring(0, regions + 1) + Files.readString(TEST_REGIONS));
      Files.writeString(directory.resolve("parcels.yml"), "parcels: []\n");
      Files.copy(
          Path.of("src/test/resources/heritage.yml"),
          directory.resolve("heritage.yml"),
          java.nio.file.StandardCopyOption.REPLACE_EXISTING);
      Files.copy(
          Path.of("../../../server/owned/plugins/TheStorm/plot-reconcile.json"),
          directory.resolve("plot-reconcile.json"),
          java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    var database = StormDatabase.open(directory.resolve("t.db"));
    this.database = database;
    services.provide(Wallets.class, wallets);
    services.provide(CrystalFormatter.class, new Formatter());
    services.provide(
        TrackLevels.class,
        new TrackLevels() {
          @Override
          public int level(Player player, Track track) {
            return governor.getOrDefault(player.getUniqueId(), 0);
          }

          @Override
          public boolean isLoaded(UUID player) {
            return true;
          }
        });
    services.provide(PlayerDirectory.class, new Directory());
    services.provide(SealedWorlds.class, sealed);
    services.provide(ExpansionSettings.class, new ExpansionSettings(2000, 10, 100, 64, 32, 16, 30));
    services.provide(
        ManagedGameplay.class,
        new ManagedGameplay((key, actor) -> CompletableFuture.completedFuture(false), () -> {}));
    var context =
        new ModuleContext(
            this,
            getLifecycleManager(),
            new PaperScheduler(this),
            new DirectComputePool(),
            database,
            services,
            directory,
            InstantSource.system(),
            RandomGenerator.getDefault(),
            getComponentLogger());
    new com.shepherdjerred.thestorm.mail.MailModule().enable(context);
    new TownsModule().enable(context);
  }

  @Override
  public void onDisable() {
    if (database != null) {
      database.close();
    }
  }

  private static final class Formatter implements CrystalFormatter {

    @Override
    public String words(Crystals amount) {
      return amount.amount() + (amount.amount() == 1 ? " crystal" : " crystals");
    }

    @Override
    public String symbol(Crystals amount) {
      return amount.amount() + " CR";
    }
  }

  private final class Directory implements PlayerDirectory {

    @Override
    public CompletableFuture<Optional<KnownPlayer>> byName(String name) {
      return CompletableFuture.completedFuture(
          Optional.ofNullable(known.get(name.toLowerCase(Locale.ROOT))));
    }

    @Override
    public CompletableFuture<Optional<KnownPlayer>> byId(UUID uuid) {
      return CompletableFuture.completedFuture(
          known.values().stream().filter(player -> player.uuid().equals(uuid)).findFirst());
    }
  }
}
