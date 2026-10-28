package com.shepherdjerred.thestorm.qol.app;

import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.Spot;
import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.StoredShelf;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** The banks in memory. The database is the record; this is the copy the main thread reads. */
public final class BankBook {

  private final Map<String, StoredBank> byId = new HashMap<>();
  private boolean loaded;

  /** Replaces every bank. Called once, when storage has been read. */
  public void load(List<StoredBank> banks) {
    byId.clear();
    for (var bank : banks) {
      byId.put(bank.id(), bank);
    }
    loaded = true;
  }

  public boolean isLoaded() {
    return loaded;
  }

  public Optional<StoredBank> get(String id) {
    return Optional.ofNullable(byId.get(id));
  }

  public Optional<StoredBank> atSign(Spot spot) {
    return byId.values().stream().filter(bank -> same(bank.sign(), spot)).findFirst();
  }

  public Optional<StoredBank> atContainer(Spot spot) {
    return byId.values().stream()
        .filter(
            bank ->
                same(bank.container(), spot)
                    || bank.shelves().stream().anyMatch(shelf -> same(shelf.container(), spot)))
        .findFirst();
  }

  public List<StoredBank> all() {
    return List.copyOf(byId.values());
  }

  public Optional<StoredShelf> shelfAtSign(Spot spot) {
    return byId.values().stream()
        .flatMap(bank -> bank.shelves().stream())
        .filter(shelf -> same(shelf.sign(), spot))
        .findFirst();
  }

  /** The shelf whose sign or container is {@code spot}, and the bank it belongs to. */
  public Optional<StoredBank> bankOfShelf(Spot spot) {
    return byId.values().stream()
        .filter(
            bank ->
                bank.shelves().stream()
                    .anyMatch(shelf -> same(shelf.sign(), spot) || same(shelf.container(), spot)))
        .findFirst();
  }

  public int ownedBy(UUID owner) {
    return (int) byId.values().stream().filter(bank -> bank.owner().equals(owner)).count();
  }

  public void put(StoredBank bank) {
    byId.put(bank.id(), bank);
  }

  public void remove(String id) {
    byId.remove(id);
  }

  private static boolean same(Spot left, Spot right) {
    return left.isAt(right.world(), right.x(), right.y(), right.z());
  }
}
