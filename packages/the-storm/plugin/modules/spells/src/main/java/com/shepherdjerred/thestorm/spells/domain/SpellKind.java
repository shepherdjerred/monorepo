package com.shepherdjerred.thestorm.spells.domain;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/**
 * Every spell The Storm knows. The id (the lowercase name) is the {@code spells.yml} key, the
 * {@code thestorm:spell} item key's value, the command argument and the learned-permission suffix.
 * Ids are single words, as they were under MagicSpells in 2015.
 */
public enum SpellKind {
  MARK,
  RECALL,
  HASTE,
  FIRENOVA,
  CRIPPLE,
  CONFUSION,
  ROAR,
  SILENCE,
  DOWSE,
  CLEANSE,
  PHASE,
  WALL,
  GEYSER,
  STEALTH,
  FARM,
  FORCEPUSH,
  DISARM,
  SHADOWSTEP,
  DIVINE,
  LEAP,
  DAWN,
  DUSK,
  FREEZE,
  DRAINLIFE,
  BLINK,
  CARPET,
  ENTOMB,
  PURGE,
  STORMCALL,
  WARD,
  THUNDERCLAP,
  CHAINLIGHTNING;

  /** The stable lowercase id. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The spell with {@code id}, if any. */
  public static Optional<SpellKind> byId(String id) {
    return Arrays.stream(values()).filter(kind -> kind.id().equals(id)).findFirst();
  }
}
