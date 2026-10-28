package com.shepherdjerred.thestorm.shops.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeChecks;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import java.time.Instant;
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

  private static final AccountId TREASURY = new AccountId.Server();

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
    var due =
        deal.sameAccountAllowed() && payer.equals(deal.payee().account())
            ? Money.crystals(deal.tax())
            : deal.price();
    if (due.isZero()) {
      return completedFuture(Optional.empty());
    }
    return ledger(() -> wallets.balance(payer, due.currency()))
        .thenApply(
            balance ->
                balance.isAtLeast(due)
                    ? Optional.empty()
                    : Optional.of(
                        payer.equals(deal.customer().account())
                            ? new TradeProblem.CustomerCannotPay(balance.amount(), due.amount())
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
          trail,
          deal);
    }
    deal.shop().holdings().remove(deal.quantity());
    deal.customer().holdings().add(deal.quantity());
    return completedFuture(new TradeOutcome.Completed(receipt));
  }

  private CompletableFuture<TradeOutcome> sell(Deal deal, LedgerTrail trail) {
    var escrow = deal.customer().holdings();
    escrow.remove(deal.quantity());
    trail.escrowTaken();
    return pay(deal, trail)
        // Capture a failed payment as a value, so the escrowed items go back on the main thread.
        .<Result<Result<Receipt, EconomyError>, Throwable>>handle(
            (payment, error) -> error == null ? Result.ok(payment) : Result.err(error))
        .thenComposeAsync(
            attempt ->
                switch (attempt) {
                  case Result.Err<Result<Receipt, EconomyError>, Throwable>(var error) -> {
                    escrow.addOrDrop(deal.quantity());
                    trail.escrowReleased();
                    yield CompletableFuture.failedFuture(error);
                  }
                  case Result.Ok<Result<Receipt, EconomyError>, Throwable>(
                          Result.Err<Receipt, EconomyError>(var refusal)) -> {
                    escrow.addOrDrop(deal.quantity());
                    trail.escrowReleased();
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
              () -> {
                deal.customer().holdings().addOrDrop(quantity);
                trail.escrowReleased();
              },
              Optional.of(new HeldItems(deal.goods(), quantity))),
          trail,
          deal);
    }
    deal.shop().holdings().add(quantity);
    trail.escrowReleased();
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
    if (deal.sameAccountAllowed() && deal.payer().account().equals(deal.payee().account())) {
      return paySame(deal, trail);
    }
    return paySplit(deal, trail);
  }

  private CompletableFuture<Result<Receipt, EconomyError>> paySame(Deal deal, LedgerTrail trail) {
    if (deal.tax() == 0) {
      return completedFuture(Result.ok(unmoved(deal)));
    }
    var tax = Money.crystals(deal.tax());
    var taxReason = deal.reason() + ":tax";
    if (deal.net() == 0) {
      return move(new Payment(deal.payer().account(), TREASURY, tax, taxReason), trail);
    }
    return move(new Payment(deal.payer().account(), TREASURY, tax, taxReason), trail)
        .thenApply(
            taxResult ->
                switch (taxResult) {
                  case Result.Ok<Receipt, EconomyError> _ -> Result.ok(unmoved(deal));
                  case Result.Err<Receipt, EconomyError> failed -> failed;
                });
  }

  private CompletableFuture<Result<Receipt, EconomyError>> paySplit(Deal deal, LedgerTrail trail) {
    if (deal.tax() == 0) {
      return move(
          new Payment(deal.payer().account(), deal.payee().account(), deal.price(), deal.reason()),
          trail);
    }
    var tax = Money.crystals(deal.tax());
    var taxReason = deal.reason() + ":tax";
    if (deal.net() == 0) {
      return move(new Payment(deal.payer().account(), TREASURY, tax, taxReason), trail);
    }
    var net = Money.crystals(deal.net());
    var split = new Split(deal, trail, tax, taxReason, net);
    return move(
            new Payment(deal.payer().account(), deal.payee().account(), net, deal.reason()), trail)
        .thenCompose(netResult -> afterNet(split, netResult));
  }

  private record Split(Deal deal, LedgerTrail trail, Money tax, String taxReason, Money net) {}

  private CompletableFuture<Result<Receipt, EconomyError>> afterNet(
      Split split, Result<Receipt, EconomyError> netResult) {
    return switch (netResult) {
      case Result.Err<Receipt, EconomyError> failed -> completedFuture(failed);
      case Result.Ok<Receipt, EconomyError>(var netReceipt) ->
          move(
                  new Payment(
                      split.deal().payer().account(), TREASURY, split.tax(), split.taxReason()),
                  split.trail())
              .thenCompose(taxResult -> afterTax(split, netReceipt, taxResult));
    };
  }

  private CompletableFuture<Result<Receipt, EconomyError>> afterTax(
      Split split, Receipt netReceipt, Result<Receipt, EconomyError> taxResult) {
    return switch (taxResult) {
      case Result.Ok<Receipt, EconomyError> _ -> completedFuture(Result.ok(netReceipt));
      case Result.Err<Receipt, EconomyError> failed ->
          move(
                  new Payment(
                      split.deal().payee().account(),
                      split.deal().payer().account(),
                      split.net(),
                      "refund:" + split.deal().reason()),
                  split.trail())
              .thenApply(
                  reversed -> {
                    if (reversed instanceof Result.Err) {
                      refunds.failed(
                          netReceipt,
                          "refund:" + split.deal().reason(),
                          "tax transfer failed and the net could not be returned",
                          Optional.empty());
                    }
                    return failed;
                  });
    };
  }

  private record Payment(AccountId from, AccountId to, Money amount, String reason) {}

  private CompletableFuture<Result<Receipt, EconomyError>> move(
      Payment payment, LedgerTrail trail) {
    var paymentResult =
        ledger(
            () ->
                wallets.transfer(payment.from(), payment.to(), payment.amount(), payment.reason()));
    note(paymentResult, "payment", trail);
    return paymentResult;
  }

  private CompletableFuture<TradeOutcome> refund(
      Receipt receipt, Refund refund, LedgerTrail trail, Deal deal) {
    var reason = "refund:" + refund.dealReason();
    if (receipt.transactionId() == 0) {
      refund.refunded().run();
      return returnTax(
          new TradeOutcome.Refunded(refund.problem()), new TaxRefund(deal, refund, trail, reason));
    }
    var transfer =
        ledger(() -> wallets.transfer(receipt.to(), receipt.from(), receipt.amount(), reason));
    note(transfer, "refund", trail);
    return transfer
        .handleAsync(
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
            mainThread)
        .thenCompose(outcome -> returnTax(outcome, new TaxRefund(deal, refund, trail, reason)));
  }

  private record TaxRefund(Deal deal, Refund refund, LedgerTrail trail, String reason) {}

  /** Returns a self-trade's tax after the net, which never moved, is already settled. */
  private CompletableFuture<TradeOutcome> returnTax(TradeOutcome outcome, TaxRefund tax) {
    var deal = tax.deal();
    var refund = tax.refund();
    var trail = tax.trail();
    var reason = tax.reason();
    if (!(outcome instanceof TradeOutcome.Refunded) || deal.tax() == 0 || deal.net() == 0) {
      return completedFuture(outcome);
    }
    var taxBack =
        ledger(
            () ->
                wallets.transfer(
                    TREASURY, deal.payer().account(), Money.crystals(deal.tax()), reason + ":tax"));
    note(taxBack, "refund", trail);
    return taxBack.handleAsync(
        (result, error) -> {
          if (error != null || result instanceof Result.Err<Receipt, EconomyError>) {
            return (TradeOutcome)
                new TradeOutcome.RefundFailed(refund.problem(), "the tax could not be returned");
          }
          return outcome;
        },
        mainThread);
  }

  /**
   * A self-trade moves no net crystals, so there is no ledger row to reverse. {@code transactionId}
   * 0 is that marker; the server's tax, when there is any, is a real transfer beside it.
   */
  private static Receipt unmoved(Deal deal) {
    return new Receipt(
        0,
        deal.payer().account(),
        deal.payee().account(),
        deal.price(),
        deal.reason(),
        Instant.EPOCH);
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
                var committed = what + " committed as ledger entry " + receipt.transactionId();
                if ("payment".equals(what)) {
                  trail.paymentCommitted(committed);
                } else if ("refund".equals(what)) {
                  trail.refundCommitted(committed);
                } else {
                  trail.record(committed);
                }
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
      case EconomyError.ZeroAmount(_) ->
          throw new IllegalStateException("a deal always costs at least one crystal");
    };
  }
}
