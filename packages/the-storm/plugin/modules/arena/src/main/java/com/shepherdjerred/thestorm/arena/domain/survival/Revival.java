package com.shepherdjerred.thestorm.arena.domain.survival;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** One uninterrupted, nearby revive channel per rescuer; any interruption resets it. */
public final class Revival {
  private record Channel(UUID target, Instant since) {}

  private final Map<UUID, Channel> channels = new HashMap<>();

  public boolean channel(UUID rescuer, UUID target, Instant now) {
    var current = channels.get(rescuer);
    if (current == null || !current.target().equals(target)) {
      channels.put(rescuer, new Channel(target, now));
      return false;
    }
    return !now.isBefore(current.since().plusSeconds(5));
  }

  public Optional<UUID> target(UUID rescuer) {
    return Optional.ofNullable(channels.get(rescuer)).map(Channel::target);
  }

  public void interrupt(UUID rescuer) {
    channels.remove(rescuer);
  }

  public void reset() {
    channels.clear();
  }
}
