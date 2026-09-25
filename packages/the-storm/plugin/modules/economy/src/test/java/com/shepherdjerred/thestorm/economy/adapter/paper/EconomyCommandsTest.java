package com.shepherdjerred.thestorm.economy.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * The economy's join listener and commands on MockBukkit, with a real SQLite ledger. Replies arrive
 * after a database round trip, so tests tick the scheduler until the expected line shows up.
 */
final class EconomyCommandsTest {

  private static final String WELCOME = "Welcome! You start with 500 crystals.";

  @TempDir Path directory;

  private ServerMock server;
  private EconomyTestPlugin plugin;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    EconomyTestPlugin.directory = directory;
    plugin =
        MockBukkit.loadWith(
            EconomyTestPlugin.class,
            new PluginDescriptionFile("TheStorm", "test", EconomyTestPlugin.class.getName()));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private static String plain(net.kyori.adventure.text.Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  /** Ticks until {@code player} receives a line containing {@code text}; returns what they saw. */
  private List<String> awaitLine(PlayerMock player, String text) throws InterruptedException {
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

  /** Lets pending database work and main-thread replies finish, returning what arrived. */
  private List<String> settle(PlayerMock player) throws InterruptedException {
    var seen = new ArrayList<String>();
    for (var attempt = 0; attempt < 40; attempt++) {
      server.getScheduler().performOneTick();
      for (var message = player.nextComponentMessage();
          message != null;
          message = player.nextComponentMessage()) {
        seen.add(plain(message));
      }
      Thread.sleep(5);
    }
    return seen;
  }

  private Crystals balance(PlayerMock player) throws Exception {
    return plugin
        .services
        .require(Wallets.class)
        .balance(new AccountId.Player(player.getUniqueId()))
        .get(10, TimeUnit.SECONDS);
  }

  private PlayerMock join(String name) throws InterruptedException {
    var player = server.addPlayer(name);
    awaitLine(player, WELCOME);
    return player;
  }

  @Test
  void theFirstJoinGrantsTheStartingBalanceOnce() throws Exception {
    var alice = join("Alice");

    alice.disconnect();
    alice.reconnect();

    assertThat(settle(alice)).noneMatch(line -> line.contains("Welcome!"));
    assertThat(balance(alice)).isEqualTo(Crystals.of(500));
  }

  @Test
  void balanceShowsYourOwnCrystals() throws Exception {
    var alice = join("Alice");

    assertThat(server.dispatchCommand(alice, "bal")).isTrue();

    assertThat(awaitLine(alice, "Balance:")).contains("[Crystals]: Balance: 500 crystals");
  }

  @Test
  void payMovesCrystalsAndTellsBothPlayers() throws Exception {
    var alice = join("Alice");
    var bob = join("Bob");

    assertThat(server.dispatchCommand(alice, "pay bob 120")).isTrue();

    assertThat(awaitLine(alice, "You paid")).contains("[Crystals]: You paid Bob 120 crystals.");
    assertThat(awaitLine(bob, "paid you")).contains("[Crystals]: Alice paid you 120 crystals.");
    assertThat(balance(alice)).isEqualTo(Crystals.of(380));
    assertThat(balance(bob)).isEqualTo(Crystals.of(620));
  }

  @Test
  void payReachesAnOfflinePlayerWhoHasJoinedBefore() throws Exception {
    var alice = join("Alice");
    var bob = join("Bob");
    bob.disconnect();

    assertThat(server.dispatchCommand(alice, "pay BOB 5")).isTrue();

    assertThat(awaitLine(alice, "You paid")).contains("[Crystals]: You paid Bob 5 crystals.");
    assertThat(balance(bob)).isEqualTo(Crystals.of(505));
  }

  @Test
  void payRefusesSomeoneWhoHasNeverPlayed() throws Exception {
    var alice = join("Alice");

    assertThat(server.dispatchCommand(alice, "pay Nobody 10")).isTrue();

    assertThat(awaitLine(alice, "Nobody named"))
        .contains("[Crystals]: Nobody named Nobody has played on The Storm.");
    assertThat(balance(alice)).isEqualTo(Crystals.of(500));
  }

  @Test
  void payRefusesMoreThanYouHave() throws Exception {
    var alice = join("Alice");
    join("Bob");

    assertThat(server.dispatchCommand(alice, "pay Bob 501")).isTrue();

    assertThat(awaitLine(alice, "Not enough"))
        .contains(
            "[Crystals]: Not enough crystals: that needs 501 crystals but the balance is 500"
                + " crystals.");
  }

  @Test
  void aPlayerWithoutPermissionCannotUseEco() throws Exception {
    var alice = join("Alice");
    var bob = join("Bob");

    server.dispatchCommand(alice, "eco give Bob 100");

    assertThat(settle(bob)).isEmpty();
    assertThat(balance(bob)).isEqualTo(Crystals.of(500));
  }

  @Test
  void anAdminGivesTakesAndSetsAndThePlayerIsTold() throws Exception {
    var admin = join("Admin");
    admin.setOp(true);
    var bob = join("Bob");

    assertThat(server.dispatchCommand(admin, "eco give Bob 100")).isTrue();
    awaitLine(admin, "Gave Bob 100 crystals.");
    awaitLine(bob, "An admin gave you 100 crystals.");

    assertThat(server.dispatchCommand(admin, "eco take Bob 50")).isTrue();
    awaitLine(admin, "Took 50 crystals from Bob.");
    awaitLine(bob, "An admin took 50 crystals from you.");

    assertThat(server.dispatchCommand(admin, "eco set Bob 1")).isTrue();
    awaitLine(admin, "Set Bob to 1 crystal.");
    awaitLine(bob, "An admin set your balance to 1 crystal.");
    assertThat(balance(bob)).isEqualTo(Crystals.of(1));
  }

  @Test
  void baltopListsNamesRichestFirst() throws Exception {
    var alice = join("Alice");
    join("Bob");
    server.dispatchCommand(alice, "pay Bob 100");
    awaitLine(alice, "You paid");

    assertThat(server.dispatchCommand(alice, "baltop")).isTrue();

    var lines = awaitLine(alice, "#2");
    assertThat(lines).contains("[Crystals]: #1 Bob 600 CR", "[Crystals]: #2 Alice 400 CR");
  }
}
