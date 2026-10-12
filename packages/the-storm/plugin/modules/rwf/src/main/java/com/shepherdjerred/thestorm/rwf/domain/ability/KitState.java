package com.shepherdjerred.thestorm.rwf.domain.ability;

/**
 * What one ability remembers about its holder between events, such as a Dwarf's level or a
 * Berserker's kills. Each ability keeps its own record type; holders of a stateless ability keep
 * {@link #NONE}.
 */
public interface KitState {

  /** No state. */
  KitState NONE = new None();

  /** The state of a stateless ability. */
  record None() implements KitState {}
}
