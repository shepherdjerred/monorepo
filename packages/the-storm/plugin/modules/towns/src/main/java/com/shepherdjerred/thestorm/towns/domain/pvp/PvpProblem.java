package com.shepherdjerred.thestorm.towns.domain.pvp;

import java.time.Instant;

/** Why a PvP change was refused. */
public sealed interface PvpProblem {

  /** The switch is already where the player asked for it. */
  record AlreadySet(boolean on) implements PvpProblem {}

  /** The player changed it too recently; they may again at {@code next}. */
  record TooSoon(Instant next) implements PvpProblem {}

  /** The player fought another player moments ago; they may change it at {@code until}. */
  record InFight(Instant until) implements PvpProblem {}

  /** The last change is still being saved. */
  record Busy() implements PvpProblem {}
}
