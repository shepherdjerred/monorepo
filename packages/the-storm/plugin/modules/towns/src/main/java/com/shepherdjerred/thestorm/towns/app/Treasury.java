package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.treasury.TreasuryProblem;
import com.shepherdjerred.thestorm.towns.domain.treasury.TreasuryRules;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;
import java.util.function.Function;

/**
 * Town treasuries, held by the economy as {@link AccountId.Town} accounts, and deleting a town,
 * which pays its treasury to the owner first. Called on the main thread; futures complete there.
 */
public final class Treasury {

  private final TownService towns;
  private final MembershipService members;
  private final Wallets wallets;

  public Treasury(TownService towns, MembershipService members, Wallets wallets) {
    this.towns = towns;
    this.members = members;
    this.wallets = wallets;
  }

  /** What {@code player}'s town holds. */
  public CompletableFuture<Result<Crystals, TreasuryProblem>> balance(UUID player) {
    return switch (TreasuryRules.member(player, towns.settling().state())) {
      case Result.Ok<Town, TreasuryProblem>(var town) ->
          wallets
              .balance(new AccountId.Town(town.id()))
              .thenApplyAsync(Result::<Crystals, TreasuryProblem>ok, mainThread());
      case Result.Err<Town, TreasuryProblem>(var problem) ->
          CompletableFuture.completedFuture(Result.err(problem));
    };
  }

  /** Pays {@code amount} from {@code player} into their town's treasury. */
  public CompletableFuture<Result<Receipt, TreasuryProblem>> deposit(UUID player, Crystals amount) {
    return move(
        TreasuryRules.member(player, towns.settling().state()),
        town ->
            wallets.transfer(
                new AccountId.Player(player),
                new AccountId.Town(town.id()),
                amount,
                "town:deposit:" + town.id()));
  }

  /** Pays {@code amount} out of {@code player}'s town's treasury to them. Owners and assistants. */
  public CompletableFuture<Result<Receipt, TreasuryProblem>> withdraw(
      UUID player, Crystals amount) {
    return move(
        TreasuryRules.withdrawer(player, towns.settling().state()),
        town ->
            wallets.transfer(
                new AccountId.Town(town.id()),
                new AccountId.Player(player),
                amount,
                "town:withdraw:" + town.id()));
  }

  private CompletableFuture<Result<Receipt, TreasuryProblem>> move(
      Result<Town, TreasuryProblem> allowed,
      Function<Town, CompletableFuture<Result<Receipt, EconomyError>>> transfer) {
    return switch (allowed) {
      case Result.Ok<Town, TreasuryProblem>(var town) -> {
        var busy = Settling.Busy.of(town, Set.of());
        if (!towns.settling().hold(busy)) {
          yield CompletableFuture.completedFuture(Result.err(new TreasuryProblem.Busy()));
        }
        try {
          yield transfer
              .apply(town)
              .whenCompleteAsync((ignored, failure) -> towns.settling().release(busy), mainThread())
              .thenApply(result -> result.mapError(Treasury::problem));
        } catch (RuntimeException failure) {
          towns.settling().release(busy);
          throw failure;
        }
      }
      case Result.Err<Town, TreasuryProblem>(var problem) ->
          CompletableFuture.completedFuture(Result.err(problem));
    };
  }

  private static TreasuryProblem problem(EconomyError error) {
    return switch (error) {
      case EconomyError.InsufficientFunds(var _, var balance, var _) ->
          new TreasuryProblem.Insufficient(balance.amount());
      case EconomyError.ZeroAmount _, EconomyError.SameAccount _ ->
          throw new IllegalStateException(
              "a treasury transfer broke the economy's rules: " + error);
    };
  }

  /**
   * Deletes {@code player}'s town, confirmed by its name. Deletion commits with a payout intent;
   * the keyed transfer follows and can resume after a crash. The town cannot survive with a drained
   * treasury, and a failed transfer leaves a durable payout to retry.
   */
  public CompletableFuture<Result<Change<Town>, List<TownProblem>>> delete(
      UUID player, String confirmation) {
    return switch (towns.checkDisband(player, confirmation)) {
      case Result.Ok<Town, List<TownProblem>>(var town) ->
          CompletableFuture.completedFuture(
              towns
                  .disband(player, confirmation)
                  .map(
                      change -> {
                        var payout = TownPayout.of(town);
                        var saved =
                            change
                                .saved()
                                .thenCompose(
                                    ignored -> {
                                      members.forgetTown(town.id());
                                      return payPayout(payout);
                                    })
                                .exceptionallyCompose(
                                    failure ->
                                        towns.settling().state().town(town.id()).isEmpty()
                                            ? CompletableFuture.failedFuture(
                                                new PayoutPending(payout.townId(), failure))
                                            : CompletableFuture.failedFuture(failure));
                        return new Change<>(town, saved);
                      }));
      case Result.Err<Town, List<TownProblem>>(var problems) ->
          CompletableFuture.completedFuture(Result.err(problems));
    };
  }

  /** Replays payout intents left by interrupted deletions after the town module starts. */
  public CompletableFuture<Void> recoverPayouts() {
    return towns
        .settling()
        .store()
        .pendingPayouts()
        .thenCompose(
            payouts ->
                CompletableFuture.allOf(
                    payouts.stream().map(this::payPayout).toArray(CompletableFuture[]::new)));
  }

  private CompletableFuture<Void> payPayout(TownPayout payout) {
    var treasury = new AccountId.Town(payout.townId());
    var owner = new AccountId.Player(payout.ownerId());
    var reason = "town:delete:" + payout.townId();
    return wallets
        .receiptFor(payout.transferKey())
        .thenCompose(
            existing -> {
              if (existing.isPresent()) {
                var receipt = existing.orElseThrow();
                if (!receipt.from().equals(treasury)
                    || !receipt.to().equals(owner)
                    || !receipt.reason().equals(reason)) {
                  return CompletableFuture.failedFuture(
                      new IllegalStateException("town payout key belongs to another transfer"));
                }
                return towns.settling().store().clearPayout(payout);
              }
              return wallets
                  .balance(treasury)
                  .thenCompose(
                      balance -> {
                        if (balance.amount() == 0) {
                          return towns.settling().store().clearPayout(payout);
                        }
                        return wallets
                            .transferOnce(
                                new KeyedTransfer(
                                    payout.transferKey(), treasury, owner, balance, reason))
                            .thenCompose(
                                result -> {
                                  if (result instanceof Result.Err<Receipt, EconomyError> error) {
                                    return CompletableFuture.failedFuture(
                                        new IllegalStateException(
                                            "town payout transfer failed: " + error.error()));
                                  }
                                  return towns.settling().store().clearPayout(payout);
                                });
                      });
            });
  }

  /** Deletion committed, but its durable payout still needs recovery. */
  public static final class PayoutPending extends CompletionException {
    private static final long serialVersionUID = 1L;

    public PayoutPending(UUID town, Throwable cause) {
      super("town " + town + " was deleted but its treasury payout is pending", cause);
    }
  }

  private Executor mainThread() {
    return towns.settling().clocks().mainThread();
  }
}
