package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.entity.Player;

/**
 * Online players' track progress, loaded when they join and dropped when they leave, so {@link
 * TrackLevels} answers from memory. Updated on the main thread.
 *
 * <p>A load that finishes after a newer change never overwrites it: loads only fill an empty entry,
 * while changes, which come from the store's latest write, always replace it.
 */
public final class LevelCache implements TrackLevels {

  private final Set<UUID> online = ConcurrentHashMap.newKeySet();
  private final Map<UUID, TrackProgress> progress = new ConcurrentHashMap<>();

  /**
   * {@inheritDoc}
   *
   * <p>0 in every track until the player's progress has loaded, a moment after they join.
   */
  @Override
  public int level(Player player, Track track) {
    return level(player.getUniqueId(), track);
  }

  /** {@code player}'s level in {@code track}; 0 if untrained, offline or not loaded yet. */
  public int level(UUID player, Track track) {
    var loaded = progress.get(player);
    return loaded == null ? 0 : loaded.level(track);
  }

  /** {@code player}'s progress once it has loaded. */
  public Optional<TrackProgress> progress(UUID player) {
    return Optional.ofNullable(progress.get(player));
  }

  /** {@code player} joined; their progress is loading. */
  public void joined(UUID player) {
    online.add(player);
  }

  /** {@code player}'s progress finished loading. Ignored if they left or a change arrived first. */
  public void loaded(UUID player, TrackProgress loaded) {
    if (online.contains(player)) {
      progress.putIfAbsent(player, loaded);
    }
  }

  /** {@code player}'s progress was changed and stored. Ignored if they are offline. */
  public void changed(UUID player, TrackProgress changed) {
    if (online.contains(player)) {
      progress.put(player, changed);
    }
  }

  /** {@code player} left. */
  public void quit(UUID player) {
    online.remove(player);
    progress.remove(player);
  }
}
