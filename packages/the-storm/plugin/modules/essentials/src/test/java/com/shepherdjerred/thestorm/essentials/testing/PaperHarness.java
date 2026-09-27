package com.shepherdjerred.thestorm.essentials.testing;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.module.Services;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.essentials.EssentialsModule;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.plugin.PluginDescriptionFile;
import org.bukkit.plugin.java.JavaPlugin;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The essentials module enabled on a MockBukkit server: the shipped essentials.yml with the spawn
 * moved onto MockBukkit's flat world (grass up to y 4), no warmup and no request interval; a temp
 * SQLite database; the given wallets and an allow-all protection.
 */
public final class PaperHarness implements AutoCloseable {

  /** The shipped config, relative to this module's project directory. */
  static final Path SHIPPED = Path.of("../../../server/owned/plugins/TheStorm/essentials.yml");

  private static Consumer<JavaPlugin> enabling = plugin -> {};

  /** A plugin whose enable runs the harness, so lifecycle registration is allowed. */
  public static class HarnessPlugin extends JavaPlugin {
    @Override
    public void onEnable() {
      enabling.accept(this);
    }
  }

  public final ServerMock server;
  public final StormDatabase database;
  public final FakeClock clock = FakeClock.at("2026-09-25T12:00:00Z");

  private PaperHarness(ServerMock server, StormDatabase database) {
    this.server = server;
    this.database = database;
  }

  public static PaperHarness start(Path directory, Wallets wallets) {
    var server = MockBukkit.mock();
    server.addSimpleWorld("world");
    writeConfig(directory);
    var database = StormDatabase.open(directory.resolve("t.db"));
    var harness = new PaperHarness(server, database);
    var services = new Services();
    services.provide(Wallets.class, wallets);
    services.provide(Protection.class, new AllowAllProtection());
    enabling =
        plugin ->
            new EssentialsModule()
                .enable(
                    new ModuleContext(
                        plugin,
                        plugin.getLifecycleManager(),
                        new PaperScheduler(plugin),
                        database,
                        services,
                        directory,
                        harness.clock,
                        RandomGenerator.getDefault(),
                        plugin.getComponentLogger()));
    try {
      MockBukkit.loadWith(
          HarnessPlugin.class,
          new PluginDescriptionFile("TheStorm", "1", HarnessPlugin.class.getName()));
    } catch (RuntimeException e) {
      harness.close();
      throw e;
    }
    return harness;
  }

  private static void writeConfig(Path directory) {
    try {
      var yaml =
          Files.readString(SHIPPED)
              .replace("  y: 64.0\n", "  y: 5.0\n")
              .replace("warmup: PT3S", "warmup: PT0S")
              .replace("tpaInterval: PT10S", "tpaInterval: PT0S")
              // MockBukkit's written-book mock cannot measure styled pages; plain text works.
              .replaceAll("<[^>\\n]+>", "");
      Files.writeString(directory.resolve("essentials.yml"), yaml);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** Runs server ticks until {@code condition} holds, failing after five seconds. */
  public void until(BooleanSupplier condition) {
    var deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
    while (!condition.getAsBoolean()) {
      if (System.nanoTime() > deadline) {
        throw new AssertionError("condition not met within 5s");
      }
      server.getScheduler().performOneTick();
      Thread.onSpinWait();
    }
  }

  /** Every message {@code player} has been sent since the last call, as plain text. */
  public static List<String> messages(PlayerMock player) {
    var out = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      out.add(PlainTextComponentSerializer.plainText().serialize(message));
    }
    return out;
  }

  /** Runs ticks until {@code player} has been sent a message containing {@code text}. */
  public List<String> awaitMessage(PlayerMock player, String text) {
    var seen = new ArrayList<String>();
    until(
        () -> {
          seen.addAll(messages(player));
          return seen.stream().anyMatch(message -> message.contains(text));
        });
    return seen;
  }

  @Override
  public void close() {
    MockBukkit.unmock();
    database.close();
  }
}
