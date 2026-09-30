package com.shepherdjerred.thestorm.economy.domain;

import java.util.List;

/**
 * An allowed transfer and the balances to store for it. The server never appears in {@code
 * updates}, so a transfer to or from it changes one stored balance and a player-to-player transfer
 * changes two.
 *
 * @param transfer the validated transfer
 * @param updates the new balances of the stored accounts involved
 */
public record Settlement(Transfer transfer, List<BalanceUpdate> updates) {

  public Settlement {
    updates = List.copyOf(updates);
  }
}
