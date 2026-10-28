package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.towns.app.LockService;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/** Charges the crystal cost of a new lock, and removes the lock if the player cannot pay. */
final class LockFee {

  static final String FREE = "thestorm.towns.lock.free";

  /** Who pays, and where the result is applied. */
  record Bill(Wallets wallets, Scheduler scheduler, LockService service, Player player) {}

  private record Outcome(
      Lock lock,
      long cost,
      @Nullable Result<Receipt, EconomyError> result,
      @Nullable Throwable failure) {}

  private LockFee() {}

  static void charge(Bill bill, Lock lock) {
    var cost = bill.service().policy().lockCost();
    var player = bill.player();
    if (cost == 0 || player.hasPermission(FREE) || Guard.actor(player).bypass()) {
      return;
    }
    var _ =
        bill.wallets()
            .transfer(
                new AccountId.Player(player.getUniqueId()),
                new AccountId.Server(),
                Money.crystals(cost),
                "lock:" + lock.id())
            .whenComplete(
                (result, failure) ->
                    bill.scheduler()
                        .runOnMainThread(
                            () -> refused(bill, new Outcome(lock, cost, result, failure))));
  }

  private static void refused(Bill bill, Outcome outcome) {
    if (outcome.failure() == null && outcome.result() instanceof Result.Ok) {
      return;
    }
    var block = outcome.lock().blocks().iterator().next();
    bill.service().unlock(block, true);
    bill.player()
        .sendMessage(
            Notices.error(
                "You cannot afford the "
                    + outcome.cost()
                    + " crystal lock cost, so the lock was removed."));
  }
}
