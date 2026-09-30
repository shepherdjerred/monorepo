package com.shepherdjerred.thestorm.shops.app;

/**
 * Items a failed trade could not put anywhere safe, kept in the refund-failure log so staff can
 * give them to whoever the ledger shows is owed them.
 *
 * @param item the item: a chest shop's serialized fingerprint, or a catalog item key
 * @param quantity how many
 */
public record HeldItems(String item, int quantity) {

  public HeldItems {
    if (item.isBlank() || quantity < 1) {
      throw new IllegalArgumentException("held items need an item and a positive quantity");
    }
  }
}
