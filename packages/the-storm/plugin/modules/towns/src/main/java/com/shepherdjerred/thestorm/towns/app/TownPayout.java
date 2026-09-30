package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Durable intent to pay a deleted town's remaining treasury to its owner exactly once. */
public record TownPayout(UUID townId, UUID ownerId, UUID transferKey) {

  public static TownPayout of(Town town) {
    var key =
        UUID.nameUUIDFromBytes(
            ("the-storm:town-delete-payout:" + town.id()).getBytes(StandardCharsets.UTF_8));
    return new TownPayout(town.id(), town.owner(), key);
  }
}
