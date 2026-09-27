package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import java.util.Optional;

/**
 * Turns "set this balance" into a transfer with the server, so an administrator's correction is a
 * ledger entry like any other and the ledger always explains every balance.
 */
public final class Adjustments {

  private Adjustments() {}

  /**
   * The transfer that brings {@code account} from {@code current} to {@code target}: from the
   * server when it must grow, to the server when it must shrink, and none when it is already there.
   */
  public static Optional<Transfer> toReach(AccountId account, Crystals current, Crystals target) {
    var difference = target.amount() - current.amount();
    if (difference > 0) {
      return Optional.of(new Transfer(new AccountId.Server(), account, new Crystals(difference)));
    }
    if (difference < 0) {
      return Optional.of(new Transfer(account, new AccountId.Server(), new Crystals(-difference)));
    }
    return Optional.empty();
  }
}
