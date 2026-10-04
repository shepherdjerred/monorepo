package com.shepherdjerred.thestorm.arena.domain.survival;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/** Run-local team supplies. A payment checks the whole price before withdrawing anything. */
public final class SupplyBank {
  public record Payment(Map<String, Integer> carried, Map<String, Integer> banked) {
    public Payment {
      carried = Map.copyOf(carried);
      banked = Map.copyOf(banked);
    }
  }

  private final Map<String, Integer> supplies = new HashMap<>();

  public Map<String, Integer> balances() {
    return Map.copyOf(supplies);
  }

  public int count(String resource) {
    return supplies.getOrDefault(resource, 0);
  }

  public void deposit(String resource, int amount) {
    if (resource.isBlank() || amount < 1) throw new IllegalArgumentException("Invalid deposit");
    supplies.put(resource, Math.addExact(count(resource), amount));
  }

  public boolean withdraw(String resource, int amount) {
    if (amount < 1) throw new IllegalArgumentException("Invalid withdrawal");
    if (count(resource) < amount) return false;
    var left = count(resource) - amount;
    if (left == 0) supplies.remove(resource);
    else supplies.put(resource, left);
    return true;
  }

  public Optional<Payment> pay(Map<String, Integer> price, Map<String, Integer> carried) {
    if (price.values().stream().anyMatch(n -> n < 1))
      throw new IllegalArgumentException("Invalid price");
    var pocket = new HashMap<String, Integer>();
    var bank = new HashMap<String, Integer>();
    for (var entry : price.entrySet()) {
      var available = Math.max(0, carried.getOrDefault(entry.getKey(), 0));
      var fromPocket = Math.min(available, entry.getValue());
      var fromBank = entry.getValue() - fromPocket;
      if (fromBank > count(entry.getKey())) return Optional.empty();
      if (fromPocket > 0) pocket.put(entry.getKey(), fromPocket);
      if (fromBank > 0) bank.put(entry.getKey(), fromBank);
    }
    bank.forEach((resource, amount) -> withdraw(resource, amount));
    return Optional.of(new Payment(pocket, bank));
  }
}
