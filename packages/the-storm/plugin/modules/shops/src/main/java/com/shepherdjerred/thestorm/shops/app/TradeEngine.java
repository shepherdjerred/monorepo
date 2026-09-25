package com.shepherdjerred.thestorm.shops.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeChecks;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;

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
 *       refunded first and the items go back only once it has; if the refund fails, the shop has
 *       paid for them, so they go to the shop (or are dropped at it), never back to the customer.
 * </ul>
 *
 * <p>Items only ever move on the main thread, after the ledger has answered, and a customer who
 * logged off in the meantime is treated as having no room: buys are refunded and returned items
 * drop where they traded. Callers lock the shop's container for the whole trade, so no other trade
 * or open inventory changes its stock or room between the checks. Call {@link #execute} on the main
 * thread; the returned future completes on the main thread.
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

  public CompletableFuture<TradeOutcome> execute(Deal deal) {
    var problem = goodsProblem(deal);
    if (problem.isPresent()) {
      return completedFuture(new TradeOutcome.Refused(problem.orElseThrow()));
    }
    return switch (deal.direction()) {
      case BUY -> buy(deal);
      case SELL -> sell(deal);
    };
  }

  private CompletableFuture<TradeOutcome> buy(Deal deal) {
    return pay(deal)
        .thenComposeAsync(
            payment ->
                switch (payment) {
                  case Result.Err<Receipt, EconomyError>(var error) ->
                      completedFuture(refused(deal, error));
                  case Result.Ok<Receipt, EconomyError>(var receipt) -> deliver(deal, receipt);
                },
            mainThread);
  }

  /**
   * Main thread, after the customer paid: move the goods, or refund if they are gone. A refund that
   * fails is logged for staff; the goods are still not delivered.
   */
  private CompletableFuture<TradeOutcome> deliver(Deal deal, Receipt receipt) {
    var problem = goodsProblem(deal);
    if (problem.isPresent()) {
      return refund(receipt, deal.reason(), problem.orElseThrow(), Settle.NOTHING);
    }
    deal.shop().holdings().remove(deal.quantity());
    deal.customer().holdings().add(deal.quantity());
    return completedFuture(new TradeOutcome.Completed(receipt));
  }

  private CompletableFuture<TradeOutcome> sell(Deal deal) {
    var escrow = deal.customer().holdings();
    escrow.remove(deal.quantity());
    return pay(deal)
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
                      stock(deal, receipt);
                },
            mainThread);
  }

  /**
   * Main thread, after the shop paid: put the escrowed items in the shop. If they no longer fit,
   * the payment is refunded first; the items go back to the customer only once the refund has gone
   * through. If the refund fails the shop has paid for them, so they go to the shop (or are dropped
   * at it), never back to the customer.
   */
  private CompletableFuture<TradeOutcome> stock(Deal deal, Receipt receipt) {
    var room = deal.shop().holdings().stockpile().space();
    if (room < deal.quantity()) {
      var quantity = deal.quantity();
      return refund(
          receipt,
          deal.reason(),
          new TradeProblem.ShopFull(room, quantity),
          new Settle(
              () -> deal.customer().holdings().addOrDrop(quantity),
              () -> deal.shop().holdings().addOrDrop(quantity)));
    }
    deal.shop().holdings().add(deal.quantity());
    return completedFuture(new TradeOutcome.Completed(receipt));
  }

  /**
   * What happens to escrowed goods once a refund settles.
   *
   * @param refunded runs when the money went back
   * @param refundFailed runs when it could not
   */
  private record Settle(Runnable refunded, Runnable refundFailed) {
    static final Settle NOTHING = new Settle(() -> {}, () -> {});
  }

  private CompletableFuture<Result<Receipt, EconomyError>> pay(Deal deal) {
    return wallets.transfer(
        deal.payer().account(), deal.payee().account(), deal.price(), deal.reason());
  }

  private CompletableFuture<TradeOutcome> refund(
      Receipt receipt, String dealReason, TradeProblem problem, Settle settle) {
    var reason = "refund:" + dealReason;
    return wallets
        .transfer(receipt.to(), receipt.from(), receipt.amount(), reason)
        .handleAsync(
            (result, error) -> {
              if (error != null) {
                settle.refundFailed().run();
                return refundFailed(receipt, reason, problem, error.toString());
              }
              return switch (result) {
                case Result.Ok<Receipt, EconomyError>(_) -> {
                  settle.refunded().run();
                  yield new TradeOutcome.Refunded(problem);
                }
                case Result.Err<Receipt, EconomyError>(var refusal) -> {
                  settle.refundFailed().run();
                  yield refundFailed(receipt, reason, problem, refusal.toString());
                }
              };
            },
            mainThread);
  }

  private TradeOutcome refundFailed(
      Receipt receipt, String reason, TradeProblem problem, String why) {
    refunds.failed(receipt, reason, why);
    return new TradeOutcome.RefundFailed(problem, why);
  }

  private static Optional<TradeProblem> goodsProblem(Deal deal) {
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
