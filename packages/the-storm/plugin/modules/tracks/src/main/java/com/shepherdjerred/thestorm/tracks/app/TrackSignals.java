package com.shepherdjerred.thestorm.tracks.app;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

/** A track level was saved, or a joining player's levels finished loading. Main thread only. */
public final class TrackSignals {

  private final List<Consumer<Grant>> purchases = new ArrayList<>();
  private final List<Consumer<UUID>> loaded = new ArrayList<>();

  public void subscribePurchases(Consumer<Grant> listener) {
    purchases.add(listener);
  }

  public void subscribeLoaded(Consumer<UUID> listener) {
    loaded.add(listener);
  }

  public void purchased(UUID player, Track track, int level) {
    var grant = new Grant(player, track, level);
    List.copyOf(purchases).forEach(listener -> listener.accept(grant));
  }

  public void loaded(UUID player) {
    List.copyOf(loaded).forEach(listener -> listener.accept(player));
  }

  /**
   * A track level that was just saved.
   *
   * @param player who bought it
   * @param track which track
   * @param level the level just saved
   */
  public record Grant(UUID player, Track track, int level) {

    public Grant {
      if (level < 1 || level > Track.MAX_LEVEL) {
        throw new IllegalArgumentException(
            "track level must be 1.." + Track.MAX_LEVEL + ": " + level);
      }
    }
  }
}
