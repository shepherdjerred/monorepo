package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import java.util.UUID;

/**
 * The player trading.
 *
 * @param id their id
 * @param name their current name, for the owner's notices
 */
public record Customer(UUID id, String name) {

  public AccountId account() {
    return new AccountId.Player(id);
  }
}
