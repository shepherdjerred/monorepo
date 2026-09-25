package com.shepherdjerred.thestorm.spells.domain;

import com.shepherdjerred.thestorm.spells.domain.geometry.Vec3;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Active Ward bubbles. Each caster has at most one; casting again moves it. Hostile creatures are
 * pushed out of a ward and cannot pick a target inside it. Main thread only.
 */
public final class Wards {

  private final Map<UUID, Ward> byOwner = new LinkedHashMap<>();

  /**
   * One ward.
   *
   * @param owner the caster
   * @param world the world key
   * @param centre the bubble's centre
   * @param radius the bubble's radius in blocks
   * @param push how hard monsters inside are pushed out, in blocks per tick
   * @param until when it fades
   */
  public record Ward(
      UUID owner, String world, Vec3 centre, double radius, double push, Instant until) {

    public Ward {
      if (!(radius > 0)) {
        throw new IllegalArgumentException("a ward needs a positive radius: " + radius);
      }
    }

    /** True when {@code point} in {@code pointWorld} is inside the bubble. */
    public boolean contains(String pointWorld, Vec3 point) {
      return world.equals(pointWorld) && centre.distance(point) <= radius;
    }
  }

  /** Raises (or moves) {@code ward}'s owner's ward. */
  public void raise(Ward ward) {
    byOwner.put(ward.owner(), ward);
  }

  /** The wards still standing at {@code now}; faded ones are dropped. */
  public List<Ward> active(Instant now) {
    byOwner.values().removeIf(ward -> !ward.until().isAfter(now));
    return new ArrayList<>(byOwner.values());
  }

  /** A ward standing over {@code point} at {@code now}, if any. */
  public Optional<Ward> covering(String world, Vec3 point, Instant now) {
    return active(now).stream().filter(ward -> ward.contains(world, point)).findFirst();
  }
}
