package com.shepherdjerred.thestorm.shops.app;

import java.util.HashSet;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.Set;
import java.util.UUID;

/**
 * Trades waiting on the ledger. While a shop is busy its container is frozen (no opening, hoppers
 * or breaking) and its customer cannot start another trade, so the stock and room checked before
 * payment are still there after it. Main thread only.
 */
public final class ShopLocks {

  private final Set<Long> shops = new HashSet<>();
  private final Set<UUID> customers = new HashSet<>();

  /** A held lock; release it exactly once when the trade settles. */
  public final class Lease {
    private final OptionalLong shop;
    private final UUID customer;
    private boolean released;

    private Lease(OptionalLong shop, UUID customer) {
      this.shop = shop;
      this.customer = customer;
    }

    public void release() {
      if (released) {
        throw new IllegalStateException("lease released twice");
      }
      released = true;
      shop.ifPresent(shops::remove);
      customers.remove(customer);
    }
  }

  /** Locks the shop (if any) and the customer, or returns empty if either is already busy. */
  public Optional<Lease> acquire(OptionalLong shop, UUID customer) {
    if (customers.contains(customer) || (shop.isPresent() && shops.contains(shop.getAsLong()))) {
      return Optional.empty();
    }
    customers.add(customer);
    shop.ifPresent(shops::add);
    return Optional.of(new Lease(shop, customer));
  }

  public boolean isBusy(long shop) {
    return shops.contains(shop);
  }
}
