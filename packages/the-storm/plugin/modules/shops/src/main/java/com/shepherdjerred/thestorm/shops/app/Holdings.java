package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.trade.Stockpile;

/**
 * One side's supply of a shop's item: a player's inventory, a shop container, or the server's
 * endless stock. Implementations read the live inventory on every call. Main thread only.
 */
public interface Holdings {

  /** A side with endless stock and room that ignores every change: admin and catalog shops. */
  Holdings UNLIMITED =
      new Holdings() {
        @Override
        public Stockpile stockpile() {
          return Stockpile.UNLIMITED;
        }

        @Override
        public void remove(int quantity) {}

        @Override
        public void add(int quantity) {}

        @Override
        public void addOrDrop(int quantity) {}
      };

  /** How many matching items there are and how many more fit, right now. */
  Stockpile stockpile();

  /**
   * Takes {@code quantity} items.
   *
   * @throws IllegalStateException if fewer are held; callers check {@link #stockpile()} first
   */
  void remove(int quantity);

  /**
   * Adds {@code quantity} items.
   *
   * @throws IllegalStateException if they do not fit; callers check {@link #stockpile()} first
   */
  void add(int quantity);

  /** Gives back items taken earlier: whatever does not fit is dropped where the holder stands. */
  void addOrDrop(int quantity);
}
