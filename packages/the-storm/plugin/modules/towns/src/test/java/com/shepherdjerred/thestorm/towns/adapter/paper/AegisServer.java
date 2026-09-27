package com.shepherdjerred.thestorm.towns.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.event.Event;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.LivingEntityMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.simulate.entity.LivingEntitySimulation;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * A MockBukkit server for listener tests with the shipped {@code towns.yml} and a real SQLite
 * store. Alice founds Aegis and claims chunks (10, 10) and (11, 10), blocks x 160..191, z 160..175;
 * chunk (9, 10), blocks x 144..159, is wilderness; spawn covers chunks -4..3.
 */
abstract class AegisServer {

  static final int Y = 64;
  static final int Z = 165;

  /** Last wilderness column before Aegis. */
  static final int WILD_X = 159;

  /** First column of Aegis. */
  static final int CLAIM_X = 160;

  @TempDir Path directory;

  ServerMock server;
  WorldMock world;
  TownsTestPlugin plugin;
  PlayerMock alice;
  PlayerMock bob;

  @BeforeEach
  void start() throws InterruptedException {
    server = MockBukkit.mock();
    world = server.addSimpleWorld("world");
    TownsTestPlugin.directory = directory;
    plugin = load();
    alice = server.addPlayer("Alice");
    bob = server.addPlayer("Bob");

    assertThat(server.dispatchCommand(alice, "town create Aegis")).isTrue();
    awaitLine(alice, "Founded Aegis");
    alice.teleport(new Location(world, 165, Y, Z));
    assertThat(server.dispatchCommand(alice, "claim")).isTrue();
    awaitLine(alice, "Claimed chunk 10, 10 for Aegis.");
    alice.teleport(new Location(world, 180, Y, Z));
    server.dispatchCommand(alice, "claim");
    awaitLine(alice, "Claimed chunk 11, 10 for Aegis.");
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  TownsTestPlugin load() {
    return MockBukkit.loadWith(
        TownsTestPlugin.class,
        new PluginDescriptionFile("TheStorm", "test", TownsTestPlugin.class.getName()));
  }

  Block block(int x, int y, int z) {
    return world.getBlockAt(x, y, z);
  }

  static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  /** Ticks until {@code player} receives a line containing {@code text}; returns what they saw. */
  List<String> awaitLine(PlayerMock player, String text) throws InterruptedException {
    var seen = new ArrayList<String>();
    for (var attempt = 0; attempt < 400; attempt++) {
      server.getScheduler().performOneTick();
      for (var message = player.nextComponentMessage();
          message != null;
          message = player.nextComponentMessage()) {
        seen.add(plain(message));
      }
      if (seen.stream().anyMatch(line -> line.contains(text))) {
        return seen;
      }
      Thread.sleep(5);
    }
    return fail("%s never saw \"%s\"; saw %s", player.getName(), text, seen);
  }

  <T extends Event> T call(T event) {
    server.getPluginManager().callEvent(event);
    return event;
  }

  boolean breakAllowed(PlayerMock player, Block block) {
    return !call(new BlockBreakEvent(block, player)).isCancelled();
  }

  /** Has MockBukkit fire the damage event for {@code attacker} hitting {@code victim}. */
  static boolean hitAllowed(Entity attacker, Entity victim) {
    var simulation = new LivingEntitySimulation((LivingEntityMock) victim);
    return !simulation.simulateDamage(1.0, attacker).isCancelled();
  }
}
