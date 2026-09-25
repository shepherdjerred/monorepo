package com.shepherdjerred.thestorm.tracks.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.plugin.PluginDescriptionFile;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.command.ConsoleCommandSenderMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/**
 * {@code /perks} on MockBukkit, with a real SQLite store and fake economy and LuckPerms. Replies
 * arrive after a database round trip, so tests tick the scheduler until the expected line shows up.
 */
final class PerksCommandsTest {

  @TempDir Path directory;

  private ServerMock server;
  private TracksTestPlugin plugin;

  @BeforeEach
  void start() {
    server = MockBukkit.mock();
    TracksTestPlugin.directory = directory;
    plugin =
        MockBukkit.loadWith(
            TracksTestPlugin.class,
            new PluginDescriptionFile("TheStorm", "test", TracksTestPlugin.class.getName()));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  private static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  private static void drain(PlayerMock player, List<String> into) {
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      into.add(plain(message));
    }
  }

  /** Ticks until {@code player} receives a line containing {@code text}; returns what they saw. */
  private List<String> awaitLine(PlayerMock player, String text) throws InterruptedException {
    var seen = new ArrayList<String>();
    for (var attempt = 0; attempt < 400; attempt++) {
      server.getScheduler().performOneTick();
      drain(player, seen);
      if (seen.stream().anyMatch(line -> line.contains(text))) {
        return seen;
      }
      Thread.sleep(5);
    }
    return fail("%s never saw \"%s\"; saw %s", player.getName(), text, seen);
  }

  /** Joins {@code name} and waits until their tracks have loaded. */
  private PlayerMock join(String name) throws InterruptedException {
    var player = server.addPlayer(name);
    for (var attempt = 0; attempt < 400; attempt++) {
      server.getScheduler().performOneTick();
      if (plugin.cache.progress(player.getUniqueId()).isPresent()) {
        return player;
      }
      Thread.sleep(5);
    }
    return fail("%s's tracks never loaded", name);
  }

  /**
   * Waits until {@code player}'s track groups, which sync off the main thread, are {@code want}.
   */
  private void awaitGroups(PlayerMock player, Set<String> want) throws InterruptedException {
    for (var attempt = 0; attempt < 400; attempt++) {
      if (plugin.permissions().groupsOf(player.getUniqueId()).equals(want)) {
        return;
      }
      server.getScheduler().performOneTick();
      Thread.sleep(5);
    }
    assertThat(plugin.permissions().groupsOf(player.getUniqueId())).isEqualTo(want);
  }

  private void give(PlayerMock player, long crystals) {
    plugin.wallets.give(new AccountId.Player(player.getUniqueId()), crystals);
  }

  @Test
  void perksListsEveryTrack() throws Exception {
    var alice = join("Alice");
    give(alice, 1_000);

    assertThat(server.dispatchCommand(alice, "perks")).isTrue();

    var lines = awaitLine(alice, "Buy the next level");
    assertThat(lines).contains("[Tracks]: Your tracks:");
    assertThat(lines)
        .contains(
            " - Shopkeeper untrained - next I: 1,000 crystals - /perks buy shopkeeper",
            " - Governor untrained - next I: 1,000 crystals - /perks buy governor");
  }

  @Test
  void buyingTakesTwoStepsAndGrantsTheLevel() throws Exception {
    var alice = join("Alice");
    give(alice, 5_000);

    server.dispatchCommand(alice, "perks buy mechanic");
    var offer = awaitLine(alice, "to confirm");
    assertThat(offer)
        .anyMatch(
            line ->
                line.startsWith("[Tracks]: Train Mechanic I for 1,000 crystals? It will be your"));
    assertThat(plugin.cache.level(alice.getUniqueId(), Track.MECHANIC)).isZero();

    server.dispatchCommand(alice, "perks buy mechanic");
    var bought = awaitLine(alice, "primary track.");

    assertThat(bought)
        .contains(
            "[Tracks]: You trained Mechanic I for 1,000 crystals.",
            "[Tracks]: Mechanic is now your primary track.");
    assertThat(plugin.cache.level(alice.getUniqueId(), Track.MECHANIC)).isEqualTo(1);
    assertThat(plugin.wallets.balanceOf(new AccountId.Player(alice.getUniqueId())))
        .isEqualTo(4_000);
    awaitGroups(alice, Set.of("storm-mechanic-1"));
  }

  @Test
  void anOfferForAnotherTrackIsNotAConfirmation() throws Exception {
    var alice = join("Alice");
    give(alice, 5_000);

    server.dispatchCommand(alice, "perks buy mechanic");
    awaitLine(alice, "to confirm");
    server.dispatchCommand(alice, "perks buy engineer");
    var lines = awaitLine(alice, "to confirm");

    assertThat(lines).anyMatch(line -> line.contains("Train Engineer I"));
    assertThat(plugin.wallets.receipts()).isEmpty();
  }

  @Test
  void aPlayerWhoCannotBuyIsToldWhy() throws Exception {
    var alice = join("Alice");

    server.dispatchCommand(alice, "perks buy mechanic");

    assertThat(awaitLine(alice, "You need"))
        .contains("[Tracks]: You need 1,000 crystals and have 0 crystals.");
  }

  @Test
  void anUnknownTrackIsNamed() throws Exception {
    var alice = join("Alice");

    server.dispatchCommand(alice, "perks buy wizard");

    assertThat(awaitLine(alice, "no track"))
        .contains(
            "[Tracks]: There is no track called wizard. Tracks: shopkeeper, mechanic, engineer,"
                + " spellcaster, governor");
  }

  @Test
  void infoDescribesEveryLevel() throws Exception {
    var alice = join("Alice");

    server.dispatchCommand(alice, "perks info governor");

    var lines = awaitLine(alice, "Sovereign");
    assertThat(lines.getFirst()).startsWith("[Tracks]: Governor: Found and grow a town.");
    assertThat(lines).contains(" - I Founder", "     Found a town.");
  }

  @Test
  void theAdminCommandsNeedPermission() throws Exception {
    var alice = join("Alice");

    server.dispatchCommand(alice, "perks admin set Alice mechanic 3");
    Thread.sleep(50);
    server.getScheduler().performOneTick();

    assertThat(plugin.cache.level(alice.getUniqueId(), Track.MECHANIC)).isZero();
  }

  @Test
  void anAdminCanSetALevel() throws Exception {
    var alice = join("Alice");
    var admin = join("Admin");
    admin.setOp(true);

    server.dispatchCommand(admin, "perks admin set alice mechanic 3");

    assertThat(awaitLine(admin, "Set Alice")).contains("[Tracks]: Set Alice's Mechanic to III.");
    assertThat(awaitLine(alice, "An admin"))
        .contains("[Tracks]: An admin set your Mechanic to III.");
    assertThat(plugin.cache.level(alice.getUniqueId(), Track.MECHANIC)).isEqualTo(3);
    awaitGroups(alice, Set.of("storm-mechanic-3"));
  }

  @Test
  void anAdminCanSetAnOfflinePlayerFoundInThePlayerDirectory() throws Exception {
    var bob = join("Bob");
    plugin.players.joined(bob.getUniqueId(), "Bob");
    bob.disconnect();
    var admin = join("Admin");
    admin.setOp(true);

    server.dispatchCommand(admin, "perks admin set bob engineer 2");

    assertThat(awaitLine(admin, "Set Bob")).contains("[Tracks]: Set Bob's Engineer to II.");
    awaitGroups(bob, Set.of("storm-engineer-2"));
  }

  @Test
  void anAdminIsToldWhenNobodyHasThatName() throws Exception {
    var admin = join("Admin");
    admin.setOp(true);

    server.dispatchCommand(admin, "perks admin reset Nobody");

    assertThat(awaitLine(admin, "Nobody named"))
        .contains("[Tracks]: Nobody named Nobody has played on The Storm.");
  }

  @Test
  void anAdminCannotPushASecondaryPastThePrimary() throws Exception {
    join("Alice");
    var admin = join("Admin");
    admin.setOp(true);
    server.dispatchCommand(admin, "perks admin set Alice mechanic 1");
    awaitLine(admin, "Set Alice");

    server.dispatchCommand(admin, "perks admin set Alice engineer 2");

    assertThat(awaitLine(admin, "would pass"))
        .contains("[Tracks]: Engineer II would pass the primary track, Mechanic I.");
  }

  @Test
  void anAdminResetNeedsConfirmation() throws Exception {
    var alice = join("Alice");
    var admin = join("Admin");
    admin.setOp(true);
    server.dispatchCommand(admin, "perks admin set Alice mechanic 2");
    awaitLine(admin, "Set Alice");

    server.dispatchCommand(admin, "perks admin reset Alice");
    assertThat(awaitLine(admin, "to confirm")).anyMatch(line -> line.contains("with no refund"));
    assertThat(plugin.cache.level(alice.getUniqueId(), Track.MECHANIC)).isEqualTo(2);

    server.dispatchCommand(admin, "perks admin reset Alice");
    assertThat(awaitLine(admin, "Reset Alice")).contains("[Tracks]: Reset Alice's tracks.");
    assertThat(plugin.cache.level(alice.getUniqueId(), Track.MECHANIC)).isZero();
    awaitGroups(alice, Set.of());
  }

  @Test
  void quittingForgetsTheLevels() throws Exception {
    var alice = join("Alice");
    var admin = join("Admin");
    admin.setOp(true);
    server.dispatchCommand(admin, "perks admin set Alice mechanic 2");
    awaitLine(admin, "Set Alice");

    alice.disconnect();

    assertThat(plugin.cache.progress(alice.getUniqueId())).isEmpty();
  }

  @Test
  void theConsoleCannotBuy() {
    ConsoleCommandSenderMock console = server.getConsoleSender();

    server.dispatchCommand(console, "perks buy mechanic");

    var reply = console.nextComponentMessage();
    assertThat(reply).isNotNull();
    assertThat(plain(Objects.requireNonNull(reply)))
        .isEqualTo("[Tracks]: Only players can train tracks.");
  }
}
