package com.shepherdjerred.thestorm.arena.domain.reward;

import com.shepherdjerred.thestorm.arena.domain.kit.ItemSpec;
import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;

/**
 * A weighted loot table, rolled {@code rolls} times with replacement.
 *
 * @param rolls how many items one roll of the table gives
 * @param entries what can come out
 */
public record LootTable(int rolls, List<LootEntry> entries) {

  public LootTable {
    if (rolls < 1 || rolls > 27) {
      throw new IllegalArgumentException("rolls must be 1-27 (one chest): " + rolls);
    }
    if (entries.isEmpty()) {
      throw new IllegalArgumentException("a loot table needs at least one entry");
    }
    entries = List.copyOf(entries);
  }

  /** Rolls the table: {@link #rolls} weighted picks. */
  public List<ItemSpec> roll(RandomGenerator random) {
    var total = entries.stream().mapToInt(LootEntry::weight).sum();
    var picks = new ArrayList<ItemSpec>(rolls);
    for (var i = 0; i < rolls; i++) {
      picks.add(pick(random.nextInt(total)));
    }
    return List.copyOf(picks);
  }

  /** The entry at {@code ticket}, counting each entry {@code weight} times. */
  ItemSpec pick(int ticket) {
    var remaining = ticket;
    for (var entry : entries) {
      if (remaining < entry.weight()) {
        return entry.item();
      }
      remaining -= entry.weight();
    }
    throw new IllegalArgumentException("ticket " + ticket + " is past the table's total weight");
  }
}
