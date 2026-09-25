package com.shepherdjerred.thestorm.essentials.paper;

import static com.shepherdjerred.thestorm.essentials.testing.PaperHarness.messages;
import static java.util.concurrent.CompletableFuture.failedFuture;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.essentials.adapter.db.JooqModerationLogStore;
import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import com.shepherdjerred.thestorm.essentials.domain.moderation.ModerationAction;
import com.shepherdjerred.thestorm.essentials.testing.FakeWallets;
import com.shepherdjerred.thestorm.essentials.testing.PaperHarness;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The Paper adapters on MockBukkit: commands reach essentials through Brigadier, as they would on a
 * server where they replace the vanilla commands of the same names.
 */
final class EssentialsPaperTest {

  @TempDir Path directory;
  PaperHarness harness;

  @AfterEach
  void stop() {
    if (harness != null) {
      harness.close();
    }
  }

  List<AuditEntry> log(UUID player) {
    return new JooqModerationLogStore(harness.database).history(player, 10).join();
  }

  @Test
  void kickIsOursAndIsAudited() {
    harness = PaperHarness.start(directory, new FakeWallets());
    var griefer = harness.server.addPlayer("Griefer");

    var handled =
        harness.server.dispatchCommand(harness.server.getConsoleSender(), "kick Griefer spamming");

    assertThat(handled).isTrue();
    assertThat(griefer.isOnline()).isFalse();
    harness.until(() -> !log(griefer.getUniqueId()).isEmpty());
    assertThat(log(griefer.getUniqueId()))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.action()).isEqualTo(ModerationAction.KICK);
              assertThat(entry.reason()).isEqualTo("spamming");
            });
  }

  @Test
  void banIsOursAndKicksOnceRecorded() {
    harness = PaperHarness.start(directory, new FakeWallets());
    var griefer = harness.server.addPlayer("Griefer");

    harness.server.dispatchCommand(
        harness.server.getConsoleSender(), "tempban Griefer 3d griefing");

    harness.until(() -> !griefer.isOnline());
    assertThat(log(griefer.getUniqueId()))
        .singleElement()
        .satisfies(
            entry -> {
              assertThat(entry.action()).isEqualTo(ModerationAction.BAN);
              assertThat(entry.expiresAt()).isPresent();
            });
  }

  @Test
  void exemptPlayersCannotBeKickedOrBanned() {
    harness = PaperHarness.start(directory, new FakeWallets());
    var moderator = harness.server.addPlayer("Moderator");
    moderator.setOp(true);
    var admin = harness.server.addPlayer("Admin");
    admin.setOp(true);
    messages(moderator);

    moderator.performCommand("ban Admin abuse");
    moderator.performCommand("kick Admin abuse");

    assertThat(messages(moderator)).filteredOn(m -> m.contains("exempt")).hasSize(2);
    assertThat(admin.isOnline()).isTrue();
    assertThat(log(admin.getUniqueId())).isEmpty();
  }

  @Test
  void onlyTheConsoleMayBanAnOfflinePlayer() {
    harness = PaperHarness.start(directory, new FakeWallets());
    var moderator = harness.server.addPlayer("Moderator");
    moderator.setOp(true);
    var absent = UUID.fromString("00000000-0000-0000-0000-0000000000ff");
    messages(moderator);

    moderator.performCommand("ban " + absent + " griefing");

    assertThat(messages(moderator)).anyMatch(m -> m.contains("Use the console"));
    harness.server.dispatchCommand(
        harness.server.getConsoleSender(), "ban " + absent + " griefing");
    harness.until(() -> !log(absent).isEmpty());
  }

  /** Wallets whose ledger is down: every transfer fails. */
  static final class BrokenWallets extends FakeWallets {
    final AtomicInteger attempts = new AtomicInteger();

    @Override
    public CompletableFuture<Result<Receipt, EconomyError>> transfer(
        AccountId from, AccountId to, Crystals amount, String reason) {
      attempts.incrementAndGet();
      return failedFuture(new IllegalStateException("ledger down"));
    }
  }

  @Test
  void aFailedPaymentReleasesTheTeleportLock() {
    var wallets = new BrokenWallets();
    harness = PaperHarness.start(directory, wallets);
    var walker = harness.server.addPlayer("Walker");
    // Spawn chunks stay loaded on a real server; MockBukkit cannot load chunks asynchronously.
    harness.server.getWorld("world").loadChunk(0, 0);
    messages(walker);

    walker.performCommand("spawn");
    var first = harness.awaitMessage(walker, "Something went wrong");
    walker.performCommand("spawn");
    var second = harness.awaitMessage(walker, "Something went wrong");

    assertThat(wallets.attempts).hasValue(2);
    assertThat(first).noneMatch(m -> m.contains("already under way"));
    assertThat(second).noneMatch(m -> m.contains("already under way"));
  }

  @Test
  void aTpaCannotBeSwappedForATpahere() {
    harness = PaperHarness.start(directory, new FakeWallets());
    var alice = harness.server.addPlayer("Alice");
    var bob = harness.server.addPlayer("Bob");
    messages(alice);
    messages(bob);

    alice.performCommand("tpa Bob");
    assertThat(messages(bob)).anyMatch(m -> m.contains("Alice wants to teleport to you"));
    alice.performCommand("tpahere Bob");
    assertThat(messages(alice)).anyMatch(m -> m.contains("You already asked to teleport to them"));

    bob.performCommand("tpaccept Alice 999");
    assertThat(messages(bob)).anyMatch(m -> m.contains("no longer open"));
  }
}
