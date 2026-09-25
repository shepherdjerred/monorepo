package com.shepherdjerred.thestorm.mechanics.app;

import com.shepherdjerred.thestorm.mechanics.domain.config.Access;
import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.List;
import java.util.Optional;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;

/**
 * Decides whether a feature is switched on and whether a player's Mechanic level allows it. Levels
 * are read from the track permissions ({@link Track#permission(int)}), which the tracks module
 * grants cumulatively.
 */
public final class Gatekeeper {

  private static final List<String> NUMERALS = List.of("", "I", "II", "III", "IV", "V");

  private final MechanicsConfig config;

  public Gatekeeper(MechanicsConfig config) {
    this.config = config;
  }

  public Access access(Feature feature) {
    return config.access(feature);
  }

  public boolean enabled(Feature feature) {
    return access(feature).enabled();
  }

  /** Why {@code player} may not create {@code feature}'s sign, if they may not. */
  public Optional<Component> mayCreate(Feature feature, Predicate<String> hasPermission) {
    var access = access(feature);
    if (!access.enabled()) {
      return Optional.of(switchedOff());
    }
    return hasLevel(hasPermission, access.level())
        ? Optional.empty()
        : Optional.of(needs(access.level(), "Building"));
  }

  /** Why {@code player} may not use {@code feature}, if they may not. */
  public Optional<Component> mayUse(Feature feature, Predicate<String> hasPermission) {
    var access = access(feature);
    if (!access.enabled()) {
      return Optional.of(switchedOff());
    }
    return hasLevel(hasPermission, access.useLevel())
        ? Optional.empty()
        : Optional.of(needs(access.useLevel(), "Using"));
  }

  /** Whether the holder of these permissions has reached {@code level} (0 needs nothing). */
  public static boolean hasLevel(Predicate<String> hasPermission, int level) {
    return level == 0 || hasPermission.test(Track.MECHANIC.permission(level));
  }

  /** {@code Mechanic III}. */
  public static String levelName(int level) {
    return "Mechanic " + NUMERALS.get(level);
  }

  private static Component needs(int level, String doing) {
    return Component.text(doing + " this needs " + levelName(level) + ".");
  }

  private static Component switchedOff() {
    return Component.text("This is switched off on this server.");
  }
}
