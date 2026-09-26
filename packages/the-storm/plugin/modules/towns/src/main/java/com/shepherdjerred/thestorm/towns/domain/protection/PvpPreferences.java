package com.shepherdjerred.thestorm.towns.domain.protection;

import java.util.UUID;

/** Each player's own PvP switch (see {@code /pvp}); on unless they turned it off. */
@FunctionalInterface
public interface PvpPreferences {

  /** Everyone fights: nobody has turned PvP off. */
  PvpPreferences EVERYONE = player -> true;

  boolean pvpOn(UUID player);
}
