package com.shepherdjerred.thestorm.rwf.app.view;

import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The killstreak items a combatant may carry, for modules that drive a holder: the materials of the
 * rewards that are called in from the sky (all but the compass).
 */
public final class StreakItems {

  /** The materials of the dropped rewards' items, as {@code TNT}. */
  public static final Set<String> DROPPED =
      Arrays.stream(Killstreak.values())
          .filter(Killstreak::dropped)
          .map(Killstreak::item)
          .collect(Collectors.toUnmodifiableSet());

  private StreakItems() {}
}
