package com.shepherdjerred.thestorm.shops.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeChecks;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Supplier;

/**
 * Settles a trade so that, from the customer's side, it happens completely or not at all, and no
 * item is ever duplicated.
 *
 * <ul>
 *   <li><b>Buying:</b> check stock and room, charge the customer, check again, then move the items
 *       from the shop to the customer. If the second check fails the charge is refunded; if the
 *       refund fails too, it is logged for staff and nothing is delivered.
 *   <li><b>Selling:</b> check the customer's items and the shop's room, take the items from the
 *       customer into escrow, pay the customer from the shop, then put the items in the shop. If
 *       the payment fails the items go back. If the shop can no longer hold them, the payment is
 *       refunded first and the items go back only once it has; if the refund fails, the items are
 *       kept in the refund-failure log for staff, never handed back to the customer.
 * </ul>
 *
 * <p>Items only ever move on the main thread, after the ledger has answered, and a customer who
 * logged off in the meantime is treated as having no room: buys are refunded and returned items
 * drop where they traded. A ledger call that throws counts as a failed payment. Callers lock the
 * shop's container for the whole trade, so no other trade or open inventory changes its stock or
 * room between the checks. Call {@link #execute} on the main thread; the returned future completes
 * on the main thread.
 */
public final class TradeEngine {

  private final Wallets wallets;
  private final Executor mainThread;
  private final RefundJournal refunds;

  public TradeEngine(Wallets wallets, Executor mainThread, RefundJournal refunds) {
    this.wallets = wallets;
    this.mainThread = mainThread;
    this.refunds = refunds;
  }

  /** Settles {@code deal}; what the ledger answers is recorded on {@code trail}. */
  public CompletableFuture<TradeOutcome> execute(Deal deal, LedgerTrail trail) {
    var problem = goodsProblem(deal);
    if (problem.isPresent()) {
      return completedFuture(new TradeOutcome.Refused(problem.orElseThrow()));
    }
    return switch (deal.direction()) {
      case BUY -> buy(deal, trail);
      case SELL -> sell(deal, trail);
    };
  }

  public CompletableFuture<TradeOutcome> execute(Deal deal) {
    return execute(deal, new LedgerTrail());
  }

  /**
   * Whether the payer can plausibly afford the deal, read before any lock is taken so a broke
   * customer clicking over and over never freezes a shop. The ledger still decides when money
   * moves. The server account always can.
   */
  public CompletableFuture<Optional<TradeProblem>> affordability(Deal deal) {
    var payer = deal.payer().account();
    if (payer instanceof AccountId.Server) {
      return completedFuture(Optional.empty());
    }
    return ledger(() -> wallets.balance(payer))
        .thenApply(
            balance ->
                balance.isAtLeast(deal.price())
                    ? Optional.empty()
                    : Optional.of(
                        payer.equals(deal.customer().account())
                            ? new TradeProblem.CustomerCannotPay(
                                balance.amount(), deal.price().amount())
                            : new TradeProblem.OwnerCannotPay()));
  }

  private CompletableFuture<TradeOutcome> buy(Deal deal, LedgerTrail trail) {
    return pay(deal, trail)
        .thenComposeAsync(
            payment ->
                switch (payment) {
                  case Result.Err<Receipt, EconomyError>(var error) ->
                      completedFuture(refused(deal, error));
                  case Result.Ok<Receipt, EconomyError>(var receipt) ->
                      deliver(deal, receipt, trail);
                },
            mainThread);
  }

  /**
   * Main thread, after the customer paid: move the goods, or refund if they are gone. A refund that
   * fails is logged for staff; the goods are still not delivered.
   */
  private CompletableFuture<TradeOutcome> deliver(Deal deal, Receipt receipt, LedgerTrail trail) {
    var problem = goodsProblem(deal);
    if (problem.isPresent()) {
      return refund(
          receipt,
          new Refund(deal.reason(), problem.orElseThrow(), () -> {}, Optional.empty()),
          trail);
    }
    deal.shop().holdings().remove(deal.quantity());
    deal.customer().holdings().add(deal.quantity());
    return completedFuture(new TradeOutcome.Completed(receipt));
  }

  private CompletableFuture<TradeOutcome> sell(Deal deal, LedgerTrail trail) {
    var escrow = deal.customer().holdings();
    escrow.remove(deal.quantity());
    return pay(deal, trail)
        // Capture a failed payment as a value, so the escrowed items go back on the main thread.
        .<Result<Result<Receipt, EconomyError>, Throwable>>handle(
            (payment, error) -> error == null ? Result.ok(payment) : Result.err(error))
        .thenComposeAsync(
            attempt ->
                switch (attempt) {
                  case Result.Err<Result<Receipt, EconomyError>, Throwable>(var error) -> {
                    escrow.addOrDrop(deal.quantity());
                    yield CompletableFuture.failedFuture(error);
                  }
                  case Result.Ok<Result<Receipt, EconomyError>, Throwable>(
                          Result.Err<Receipt, EconomyError>(var refusal)) -> {
                    escrow.addOrDrop(deal.quantity());
                    yield completedFuture(refused(deal, refusal));
                  }
                  case Result.Ok<Result<Receipt, EconomyError>, Throwable>(
                          Result.Ok<Receipt, EconomyError>(var receipt)) ->
                      stock(deal, receipt, trail);
                },
            mainThread);
  }

  /**
   * Main thread, after the shop paid: put the escrowed items in the shop. If they no longer fit,
   * the payment is refunded first; the items go back to the customer only once the refund has gone
   * through. If the refund fails the shop has paid for them, so they are kept in the refund-failure
   * log for staff rather than dropped where nobody can reach them or handed back.
   */
  private CompletableFuture<TradeOutcome> stock(Deal deal, Receipt receipt, LedgerTrail trail) {
    var room = deal.shop().holdings().stockpile().space();
    var quantity = deal.quantity();
    if (room < quantity) {
      return refund(
          receipt,
          new Refund(
              deal.reason(),
              new TradeProblem.ShopFull(room, quantity),
              () -> deal.customer().holdings().addOrDrop(quantity),
              Optional.of(new HeldItems(deal.goods(), quantity))),
          trail);
    }
    deal.shop().holdings().add(quantity);
    return completedFuture(new TradeOutcome.Completed(receipt));
  }

  /**
   * A refund to make.
   *
   * @param dealReason the trade's ledger reason
   * @param problem why the trade is being undone
   * @param refunded runs when the money went back: return escrowed goods
   * @param keptOnFailure goods to keep in the log when the money could not go back
   */
  private record Refund(
      String dealReason,
      TradeProblem problem,
      Runnable refunded,
      Optional<HeldItems> keptOnFailure) {}

  private CompletableFuture<Result<Receipt, EconomyError>> pay(Deal deal, LedgerTrail trail) {
    var payment =
        ledger(
            () ->
                wallets.transfer(
                    deal.payer().account(), deal.payee().account(), deal.price(), deal.reason()));
    note(payment, "payment", trail);
    return payment;
  }

  private CompletableFuture<TradeOutcome> refund(
      Receipt receipt, Refund refund, LedgerTrail trail) {
    var reason = "refund:" + refund.dealReason();
    var transfer =
        ledger(() -> wallets.transfer(receipt.to(), receipt.from(), receipt.amount(), reason));
    note(transfer, "refund", trail);
    return transfer.handleAsync(
        (result, error) -> {
          if (error != null) {
            return refundFailed(receipt, reason, refund, error.toString());
          }
          return switch (result) {
            case Result.Ok<Receipt, EconomyError>(_) -> {
              refund.refunded().run();
              yield new TradeOutcome.Refunded(refund.problem());
            }
            case Result.Err<Receipt, EconomyError>(var refusal) ->
                refundFailed(receipt, reason, refund, refusal.toString());
          };
        },
        mainThread);
  }

  private TradeOutcome refundFailed(Receipt receipt, String reason, Refund refund, String why) {
    refunds.failed(receipt, reason, why, refund.keptOnFailure());
    return new TradeOutcome.RefundFailed(refund.problem(), why);
  }

  /** Calls the ledger; a call that throws becomes a failed future, never a thrown exception. */
  private static <T> CompletableFuture<T> ledger(Supplier<CompletableFuture<T>> call) {
    try {
      return call.get();
    } catch (RuntimeException e) {
      return CompletableFuture.failedFuture(e);
    }
  }

  private static void note(
      CompletableFuture<Result<Receipt, EconomyError>> transfer, String what, LedgerTrail trail) {
    var _ =
        transfer.whenComplete(
            (result, error) -> {
              if (error != null) {
                trail.record(what + " failed: " + error);
              } else if (result instanceof Result.Ok<Receipt, EconomyError>(var receipt)) {
                trail.record(what + " committed as ledger entry " + receipt.transactionId());
              } else {
                trail.record(what + " refused: " + result);
              }
            });
  }

  static Optional<TradeProblem> goodsProblem(Deal deal) {
    return TradeChecks.goods(
        deal.direction(),
        deal.quantity(),
        deal.customer().holdings().stockpile(),
        deal.shop().holdings().stockpile());
  }

  private static TradeOutcome refused(Deal deal, EconomyError error) {
    return new TradeOutcome.Refused(paymentProblem(deal, error));
  }

  /** Why the ledger refused the payment, in trade terms. */
  static TradeProblem paymentProblem(Deal deal, EconomyError error) {
    return switch (error) {
      case EconomyError.InsufficientFunds(var account, var balance, var required) ->
          account.equals(deal.customer().account())
              ? new TradeProblem.CustomerCannotPay(balance.amount(), required.amount())
              : new TradeProblem.OwnerCannotPay();
      case EconomyError.SameAccount(_) -> new TradeProblem.OwnShop();
      case EconomyError.ZeroAmount() ->
          throw new IllegalStateException("a deal always costs at least one crystal");
    };
  }
}
