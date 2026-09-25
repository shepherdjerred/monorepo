package com.shepherdjerred.thestorm.essentials.domain.home;

import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import java.util.List;

/** Why a home could not be set or found. */
public sealed interface HomeError {

  /** The player already has as many homes as allowed. */
  record LimitReached(int limit) implements HomeError {}

  /** The player has not set any home. */
  record NoHomes() implements HomeError {}

  /** No home has that name. */
  record NotFound(PlaceName name, List<PlaceName> available) implements HomeError {
    public NotFound {
      available = List.copyOf(available);
    }
  }

  /** No name was given and the player has several homes, none called {@code home}. */
  record Ambiguous(List<PlaceName> available) implements HomeError {
    public Ambiguous {
      available = List.copyOf(available);
    }
  }
}
