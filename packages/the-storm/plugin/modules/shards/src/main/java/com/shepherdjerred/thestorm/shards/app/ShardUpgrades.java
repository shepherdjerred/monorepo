package com.shepherdjerred.thestorm.shards.app;

import com.shepherdjerred.thestorm.shards.domain.StormTier;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

/** A storm altar upgrade that reached a tier. Failed and shattered attempts are not published. */
public final class ShardUpgrades {

  private final List<Consumer<Upgrade>> listeners = new ArrayList<>();

  public void subscribe(Consumer<Upgrade> listener) {
    listeners.add(listener);
  }

  public void reached(UUID player, int tier) {
    var upgrade = new Upgrade(player, tier);
    List.copyOf(listeners).forEach(listener -> listener.accept(upgrade));
  }

  /**
   * A storm tier an altar upgrade reached.
   *
   * @param player who upgraded
   * @param tier the tier the item reached, from 1 to 5
   */
  public record Upgrade(UUID player, int tier) {

    public Upgrade {
      if (tier < 1 || tier > StormTier.MAX_LEVEL) {
        throw new IllegalArgumentException(
            "storm tier must be 1.." + StormTier.MAX_LEVEL + ": " + tier);
      }
    }
  }
}
