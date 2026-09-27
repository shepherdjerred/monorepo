package com.shepherdjerred.thestorm.economy.adapter.db;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import java.util.UUID;

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

  static AccountId toAccount(String kind, String id) {
    return switch (kind) {
      case PLAYER -> new AccountId.Player(UUID.fromString(id));
      case TOWN -> new AccountId.Town(UUID.fromString(id));
      case SERVER -> {
        if (!SERVER.equals(id)) {
          throw new IllegalStateException("invalid server account id: " + id);
        }
        yield new AccountId.Server();
      }
      default -> throw new IllegalStateException("unknown account kind: " + kind);
    };
  }
}
