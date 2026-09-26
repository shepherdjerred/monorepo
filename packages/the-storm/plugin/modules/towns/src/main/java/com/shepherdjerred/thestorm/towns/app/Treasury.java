package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
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
        if (towns.settling().isBusy(Settling.Busy.of(town, Set.of()))) {
          yield CompletableFuture.completedFuture(Result.err(new TreasuryProblem.Busy()));
        }
        yield transfer
            .apply(town)
            .thenApplyAsync(result -> result.mapError(Treasury::problem), mainThread());
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
   * Deletes {@code player}'s town, confirmed by its name. Its treasury is paid to the owner first,
   * in one transfer; if that fails the town is kept. If deleting then fails to save, the payout is
   * moved back and the returned change fails.
   */
  public CompletableFuture<Result<Change<Town>, List<TownProblem>>> delete(
      UUID player, String confirmation) {
    return switch (towns.checkDisband(player, confirmation)) {
      case Result.Ok<Town, List<TownProblem>>(var town) -> payOutAndDelete(town, confirmation);
      case Result.Err<Town, List<TownProblem>>(var problems) ->
          CompletableFuture.completedFuture(Result.err(problems));
    };
  }

  private CompletableFuture<Result<Change<Town>, List<TownProblem>>> payOutAndDelete(
      Town town, String confirmation) {
    var busy = Settling.Busy.of(town, Set.of());
    if (!towns.settling().hold(busy)) {
      return CompletableFuture.completedFuture(Result.err(List.of(new TownProblem.Busy())));
    }
    var treasury = new AccountId.Town(town.id());
    var owner = new AccountId.Player(town.owner());
    return wallets
        .balance(treasury)
        .thenCompose(
            balance ->
                balance.amount() == 0
                    ? CompletableFuture.completedFuture(Result.<Crystals, EconomyError>ok(balance))
                    : wallets
                        .transfer(treasury, owner, balance, "town:delete:" + town.id())
                        .thenApply(result -> result.map(Receipt::amount)))
        .handleAsync(
            (paid, failure) -> {
              towns.settling().release(busy);
              if (failure != null || !(paid instanceof Result.Ok<Crystals, EconomyError> ok)) {
                return Result.<Change<Town>, List<TownProblem>>err(
                    List.of(new TownProblem.PayoutFailed()));
              }
              return towns
                  .disband(town.owner(), confirmation)
                  .map(change -> refundIfUnsaved(change, owner, treasury, ok.value()));
            },
            mainThread());
  }

  private Change<Town> refundIfUnsaved(
      Change<Town> change, AccountId.Player owner, AccountId.Town treasury, Crystals amount) {
    members.forgetTown(change.value().id());
    var saved =
        change
            .saved()
            .exceptionallyCompose(
                failure -> {
                  if (amount.amount() == 0) {
                    return CompletableFuture.failedFuture(failure);
                  }
                  return wallets
                      .transfer(owner, treasury, amount, "town:delete-undone:" + treasury.townId())
                      .thenCompose(
                          refund -> {
                            if (!refund.isOk()) {
                              failure.addSuppressed(
                                  new IllegalStateException(
                                      "the treasury payout could not be moved back: " + refund));
                            }
                            return CompletableFuture.<Void>failedFuture(failure);
                          });
                });
    return new Change<>(change.value(), saved);
  }

  private Executor mainThread() {
    return towns.settling().clocks().mainThread();
  }
}
