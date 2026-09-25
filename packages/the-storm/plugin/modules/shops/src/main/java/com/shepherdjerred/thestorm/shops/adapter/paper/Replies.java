package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.shops.app.ShopTexts;
import com.shepherdjerred.thestorm.shops.app.TradeOutcome;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import java.util.function.LongFunction;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/** Shop messages in the house style, and the one way this adapter waits on a future. */
final class Replies {

  static final String LABEL = "Shop";

  private final Server server;
  private final Executor mainThread;
  private final ComponentLogger logger;
  private final ShopTexts texts;

  Replies(Server server, Executor mainThread, ComponentLogger logger, ShopTexts texts) {
    this.server = server;
    this.mainThread = mainThread;
    this.logger = logger;
    this.texts = texts;
  }

  ShopTexts texts() {
    return texts;
  }

  static Component info(String message) {
    return HouseStyle.info(LABEL, Component.text(message));
  }

  static Component success(String message) {
    return HouseStyle.success(LABEL, Component.text(message));
  }

  static Component error(String message) {
    return HouseStyle.error(LABEL, Component.text(message));
  }

  /**
   * Runs {@code onValue} on the main thread once {@code future} completes, with the player if they
   * are still online. A failure is logged and the player told; nothing is dropped.
   */
  <T> void whenDone(CompletableFuture<T> future, UUID player, Consumer<T> onValue) {
    var _ =
        future.whenCompleteAsync(
            (value, failure) -> {
              if (failure != null) {
                logger.error("A shop operation failed", failure);
                tell(player, error("Something went wrong with the shop; nothing changed."));
                return;
              }
              onValue.accept(value);
            },
            mainThread);
  }

  void tell(UUID player, Component message) {
    var online = server.getPlayer(player);
    if (online != null) {
      online.sendMessage(message);
    }
  }

  /** Tells the customer how a trade ended. */
  void outcome(
      Player customer, TradeOutcome outcome, String itemName, LongFunction<String> completed) {
    var message =
        switch (outcome) {
          case TradeOutcome.Completed(var receipt) ->
              success(completed.apply(receipt.amount().amount()));
          case TradeOutcome.Refused(var problem) -> error(texts.problem(problem, itemName));
          case TradeOutcome.Refunded(var problem) -> error(texts.refunded(problem, itemName));
          case TradeOutcome.RefundFailed(var problem, _) ->
              error(texts.refundFailed(problem, itemName));
        };
    tell(customer.getUniqueId(), message);
  }
}
