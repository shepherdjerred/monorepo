package com.shepherdjerred.thestorm.economy.app;

import java.util.Optional;

/**
 * One row of the leaderboard.
 *
 * @param account the player account
 * @param name the name they last joined under; empty for an account whose owner has not joined
 *     since names were recorded
 * @param balance its balance
 */
public record RankedPlayer(AccountId.Player account, Optional<String> name, Crystals balance) {

  public Wallets.Standing standing() {
    return new Wallets.Standing(account, balance);
  }
}
