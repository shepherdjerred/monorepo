package com.shepherdjerred.thestorm.essentials.domain.home;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** Setting and finding homes. */
public final class HomeRules {

  /** The name {@code /sethome} and {@code /home} use when none is given. */
  public static final PlaceName DEFAULT_NAME = new PlaceName("home");

  private HomeRules() {}

  /** What setting a home did. */
  public enum Change {
    /** A new home, counting against the limit. */
    CREATED,
    /** An existing home moved; the count is unchanged. */
    MOVED
  }

  /**
   * Decides whether {@code name} may be set given the player's {@code existing} home names and
   * their {@code limit}. Moving an existing home is always allowed.
   */
  public static Result<Change, HomeError> set(
      Collection<PlaceName> existing, PlaceName name, int limit) {
    if (existing.contains(name)) {
      return Result.ok(Change.MOVED);
    }
    if (existing.size() >= limit) {
      return Result.err(new HomeError.LimitReached(limit));
    }
    return Result.ok(Change.CREATED);
  }

  /**
   * Finds the home a player means. With a name, that home. Without one, the only home, or the one
   * with the {@link #DEFAULT_NAME default name}.
   */
  public static Result<Home, HomeError> resolve(List<Home> homes, Optional<PlaceName> requested) {
    if (homes.isEmpty()) {
      return Result.err(new HomeError.NoHomes());
    }
    var names = homes.stream().map(Home::name).sorted().toList();
    if (requested.isPresent()) {
      var name = requested.orElseThrow();
      return find(homes, name)
          .<Result<Home, HomeError>>map(Result::ok)
          .orElseGet(() -> Result.err(new HomeError.NotFound(name, names)));
    }
    if (homes.size() == 1) {
      return Result.ok(homes.getFirst());
    }
    return find(homes, DEFAULT_NAME)
        .<Result<Home, HomeError>>map(Result::ok)
        .orElseGet(() -> Result.err(new HomeError.Ambiguous(names)));
  }

  private static Optional<Home> find(List<Home> homes, PlaceName name) {
    return homes.stream().filter(home -> home.name().equals(name)).findFirst();
  }
}
