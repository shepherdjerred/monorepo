package com.shepherdjerred.thestorm.economy.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.MoneyFormatter;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import java.nio.file.Path;
import java.time.Instant;
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
  private void awaitGrant(PlayerMock player) throws Exception {
    var deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (System.nanoTime() < deadline) {
      if (balance(player).equals(Money.crystals(500))) return;
      Thread.sleep(20);
    }
    throw new AssertionError("starting balance was not granted");
  }

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

  private Money balance(PlayerMock player) throws Exception {
    return balance(player, CurrencyId.CRYSTALS);
  }

  private Money balance(PlayerMock player, CurrencyId currency) throws Exception {
    return plugin
        .services
        .require(Wallets.class)
        .balance(new AccountId.Player(player.getUniqueId()), currency)
        .get(10, TimeUnit.SECONDS);
  }

  private PlayerMock join(String name) throws Exception {
    var player = server.addPlayer(name);
    plugin
        .players()
        .recordJoin(player.getUniqueId(), name, Instant.EPOCH)
        .get(10, TimeUnit.SECONDS);
    awaitGrant(player);
    return player;
  }

  @Test
  void theModulePublishesTheFormatterWithTheShippedCurrencies() {
    var formatter = plugin.services.require(MoneyFormatter.class);

    assertThat(formatter.words(Money.crystals(1))).isEqualTo("1 crystal");
    assertThat(formatter.words(Money.crystals(1250))).isEqualTo("1,250 crystals");
    assertThat(formatter.symbol(Money.crystals(1250))).isEqualTo("1,250 CR");
    assertThat(formatter.words(Money.rwfCredits(1))).isEqualTo("1 Credit");
    assertThat(formatter.words(Money.rwfCredits(3))).isEqualTo("3 Credits");
    assertThat(formatter.symbol(Money.rwfCredits(3))).isEqualTo("3 RC");
  }

  @Test
  void theFirstJoinGrantsTheStartingBalanceOnce() throws Exception {
    var alice = join("Alice");

    alice.disconnect();
    alice.reconnect();

    assertThat(settle(alice)).noneMatch(line -> line.contains("Welcome!"));
    assertThat(balance(alice)).isEqualTo(Money.crystals(500));
  }

  @Test
  void aReturningVanillaPlayerReceivesTheStormGrantOnlyOnce() throws Exception {
    var alice = new PlayerMock(server, "Alice");
    server.getPlayerList().addOfflinePlayer(alice);
    server.getPlayerList().setFirstPlayed(alice.getUniqueId(), 1);
    assertThat(alice.hasPlayedBefore()).isTrue();
    server.addPlayer(alice);
    awaitGrant(alice);

    alice.disconnect();
    alice.reconnect();
    assertThat(settle(alice)).noneMatch(line -> line.contains("Welcome!"));
    assertThat(balance(alice)).isEqualTo(Money.crystals(500));
  }

  @Test
  void balanceListsEveryCurrency() throws Exception {
    var alice = join("Alice");

    assertThat(server.dispatchCommand(alice, "bal")).isTrue();

    assertThat(awaitLine(alice, "Balance:")).contains("[Wallet]: Balance: 500 crystals, 0 Credits");
  }

  @Test
  void balanceOfAnotherPlayerListsEveryCurrency() throws Exception {
    var admin = join("Admin");
    admin.setOp(true);
    var bob = join("Bob");
    server.dispatchCommand(admin, "eco give Bob 3 rwf_credits");
    awaitLine(bob, "An admin gave you 3 Credits.");

    assertThat(server.dispatchCommand(admin, "balance bob")).isTrue();

    assertThat(awaitLine(admin, "Bob has")).contains("[Wallet]: Bob has 500 crystals, 3 Credits.");
  }

  @Test
  void payMovesCrystalsAndTellsBothPlayers() throws Exception {
    var alice = join("Alice");
    var bob = join("Bob");

    assertThat(server.dispatchCommand(alice, "pay bob 120")).isTrue();

    assertThat(awaitLine(alice, "You paid")).contains("[Wallet]: You paid Bob 120 crystals.");
    assertThat(awaitLine(bob, "paid you")).contains("[Wallet]: Alice paid you 120 crystals.");
    assertThat(balance(alice)).isEqualTo(Money.crystals(380));
    assertThat(balance(bob)).isEqualTo(Money.crystals(620));
  }

  @Test
  void payReachesAnOfflinePlayerWhoHasJoinedBefore() throws Exception {
    var alice = join("Alice");
    var bob = join("Bob");
    bob.disconnect();

    assertThat(server.dispatchCommand(alice, "pay BOB 5")).isTrue();

    assertThat(awaitLine(alice, "You paid")).contains("[Wallet]: You paid Bob 5 crystals.");
    assertThat(balance(bob)).isEqualTo(Money.crystals(505));
  }

  @Test
  void payRefusesSomeoneWhoHasNeverPlayed() throws Exception {
    var alice = join("Alice");

    assertThat(server.dispatchCommand(alice, "pay Nobody 10")).isTrue();

    assertThat(awaitLine(alice, "Nobody named"))
        .contains("[Wallet]: Nobody named Nobody has played on The Storm.");
    assertThat(balance(alice)).isEqualTo(Money.crystals(500));
  }

  @Test
  void payRefusesMoreThanYouHave() throws Exception {
    var alice = join("Alice");
    join("Bob");

    assertThat(server.dispatchCommand(alice, "pay Bob 501")).isTrue();

    assertThat(awaitLine(alice, "Not enough"))
        .contains(
            "[Wallet]: Not enough crystals: that needs 501 crystals but the balance is 500"
                + " crystals.");
  }

  @Test
  void aPlayerWithoutPermissionCannotUseEco() throws Exception {
    var alice = join("Alice");
    var bob = join("Bob");

    server.dispatchCommand(alice, "eco give Bob 100");

    assertThat(settle(bob)).isEmpty();
    assertThat(balance(bob)).isEqualTo(Money.crystals(500));
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
    awaitLine(bob, "An admin set your crystals balance to 1 crystal.");
    assertThat(balance(bob)).isEqualTo(Money.crystals(1));
  }

  @Test
  void ecoNamesACurrencyAndLeavesTheOthersAlone() throws Exception {
    var admin = join("Admin");
    admin.setOp(true);
    var bob = join("Bob");

    assertThat(server.dispatchCommand(admin, "eco give Bob 10 rwf_credits")).isTrue();
    awaitLine(admin, "Gave Bob 10 Credits.");
    awaitLine(bob, "An admin gave you 10 Credits.");

    assertThat(server.dispatchCommand(admin, "eco take Bob 4 RWF_CREDITS")).isTrue();
    awaitLine(admin, "Took 4 Credits from Bob.");

    assertThat(server.dispatchCommand(admin, "eco take Bob 7 rwf_credits")).isTrue();
    awaitLine(admin, "Not enough Credits: that needs 7 Credits but the balance is 6 Credits.");

    assertThat(server.dispatchCommand(admin, "eco set Bob 1 rwf_credits")).isTrue();
    awaitLine(bob, "An admin set your Credits balance to 1 Credit.");

    assertThat(server.dispatchCommand(admin, "eco give Bob 5 crystals")).isTrue();
    awaitLine(admin, "Gave Bob 5 crystals.");

    assertThat(balance(bob, CurrencyId.RWF_CREDITS)).isEqualTo(Money.rwfCredits(1));
    assertThat(balance(bob)).isEqualTo(Money.crystals(505));
  }

  @Test
  void anUnknownCurrencyIsRefusedWithTheChoices() throws Exception {
    var admin = join("Admin");
    admin.setOp(true);
    var bob = join("Bob");

    assertThat(server.dispatchCommand(admin, "eco give Bob 10 shards")).isTrue();
    assertThat(awaitLine(admin, "no currency"))
        .contains(
            "[Wallet]: There is no currency called shards. Use one of: crystals, rwf_credits.");
    assertThat(server.dispatchCommand(admin, "baltop shards")).isTrue();
    awaitLine(admin, "There is no currency called shards.");
    assertThat(balance(bob)).isEqualTo(Money.crystals(500));
  }

  @Test
  void baltopListsNamesRichestFirst() throws Exception {
    var alice = join("Alice");
    join("Bob");
    server.dispatchCommand(alice, "pay Bob 100");
    awaitLine(alice, "You paid");

    assertThat(server.dispatchCommand(alice, "baltop")).isTrue();

    var lines = awaitLine(alice, "#2");
    assertThat(lines)
        .contains(
            "[Wallet]: Most crystals:", "[Wallet]: #1 Bob 600 CR", "[Wallet]: #2 Alice 400 CR");
  }

  @Test
  void baltopRanksTheNamedCurrency() throws Exception {
    var admin = join("Admin");
    admin.setOp(true);
    join("Bob");
    server.dispatchCommand(admin, "eco give Bob 3 rwf_credits");
    awaitLine(admin, "Gave Bob 3 Credits.");

    assertThat(server.dispatchCommand(admin, "baltop rwf_credits")).isTrue();

    var lines = awaitLine(admin, "#1");
    assertThat(lines).contains("[Wallet]: Most Credits:", "[Wallet]: #1 Bob 3 RC");
    assertThat(lines).noneMatch(line -> line.contains("#2"));
  }
}
