package com.shepherdjerred.thestorm.economy.adapter.db;

import com.shepherdjerred.thestorm.economy.app.AccountId;

/**
 * How an {@link AccountId} is stored: a kind column and an id column.
 *
 * @param kind {@code player}, {@code town} or {@code server}
 * @param id the player's or town's UUID, or {@code server}
 */
record AccountKey(String kind, String id) {

  static final String PLAYER = "player";
  static final String TOWN = "town";
  static final String SERVER = "server";

  static AccountKey of(AccountId account) {
    return switch (account) {
      case AccountId.Player(var uuid) -> new AccountKey(PLAYER, uuid.toString());
      case AccountId.Town(var townId) -> new AccountKey(TOWN, townId.toString());
      case AccountId.Server _ -> new AccountKey(SERVER, SERVER);
    };
  }
}
