package com.shepherdjerred.thestorm.towns.domain.region;

import com.shepherdjerred.thestorm.towns.domain.land.Owner;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import java.util.List;
import java.util.regex.Pattern;

/**
 * An administrator-defined protected area. Ordinary players may do only what {@code allow} lists;
 * explosions, fire and mob griefing never change it; nothing flows into it from outside; and it can
 * never be claimed.
 *
 * @param id a stable lowercase id, such as {@code spawn}
 * @param name shown to players, such as {@code Spawn}
 * @param areas where it is
 * @param allow what ordinary players may do inside
 */
public record AdminRegion(String id, String name, RegionAreas areas, List<RegionAllowance> allow) {

  private static final Pattern ID = Pattern.compile("[a-z0-9_-]{1,32}");

  public AdminRegion {
    if (!ID.matcher(id).matches()) {
      throw new IllegalArgumentException("region id must match " + ID.pattern() + ": " + id);
    }
    if (name.isBlank()) {
      throw new IllegalArgumentException("region " + id + " needs a name");
    }
    allow = List.copyOf(allow);
  }

  public Owner.OfRegion owner() {
    return new Owner.OfRegion(id);
  }

  /** True when an ordinary player may do {@code act} here. */
  public boolean permits(Act act) {
    return allow.stream().anyMatch(allowance -> allowance.permits(act));
  }
}
