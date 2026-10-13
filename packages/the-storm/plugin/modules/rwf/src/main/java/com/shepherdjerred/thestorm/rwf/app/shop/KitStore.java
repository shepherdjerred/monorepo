package com.shepherdjerred.thestorm.rwf.app.shop;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitLayout;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * The kits players own and the purchase outbox. A purchase is a {@link Purchase} row first, so a
 * crash between charging and granting is settled on the next start; see {@link KitShop}.
 */
public interface KitStore {

  /** The ids of the kits {@code player} owns. */
  CompletableFuture<Set<String>> owned(UUID player);

  /**
   * Opens {@code purchase} as pending. False when the player already owns the kit or already has a
   * purchase of it pending; nothing is written then.
   */
  CompletableFuture<Boolean> begin(Purchase purchase);

  /**
   * The ledger took the credits: the player owns the kit from {@code at} and the purchase is
   * granted, in one transaction. Granting a granted purchase again does nothing.
   */
  CompletableFuture<Void> grant(UUID purchase, Instant at);

  /** The ledger never took the credits: the purchase is cancelled and nothing is owned. */
  CompletableFuture<Void> cancel(UUID purchase, Instant at);

  /** Every purchase still pending, oldest first. */
  CompletableFuture<List<Purchase>> pending();

  /** What {@code player} keeps between matches: their last kit and saved layouts. */
  CompletableFuture<KitPrefs> prefs(UUID player);

  /** Saves {@code layout} as {@code player}'s layout for {@code kit}, replacing any before. */
  CompletableFuture<Void> saveLayout(UUID player, String kit, KitLayout layout);
}
