package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.trade.Stockpile;

/** A counted stack of one item with a fixed capacity; overflow from returns counts as dropped. */
final class FakeHoldings implements Holdings {

  int count;
  int capacity;
  int dropped;

  FakeHoldings(int count, int capacity) {
    this.count = count;
    this.capacity = capacity;
  }

  @Override
  public Stockpile stockpile() {
    return new Stockpile(count, Math.max(0, capacity - count));
  }

  @Override
  public void remove(int quantity) {
    if (quantity > count) {
      throw new IllegalStateException("removing " + quantity + " of " + count);
    }
    count -= quantity;
  }

  @Override
  public void add(int quantity) {
    if (count + quantity > capacity) {
      throw new IllegalStateException("adding " + quantity + " to " + count + "/" + capacity);
    }
    count += quantity;
  }

  @Override
  public void addOrDrop(int quantity) {
    var fits = Math.min(quantity, capacity - count);
    count += fits;
    dropped += quantity - fits;
  }
}
