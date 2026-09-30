package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.domain.Foci;
import com.shepherdjerred.thestorm.spells.domain.Wards;
import com.shepherdjerred.thestorm.spells.domain.cast.CooldownKey;
import com.shepherdjerred.thestorm.spells.domain.cast.Timers;
import java.util.UUID;

/**
 * The spells module's in-memory state, shared by spells, listeners and the ticker. Main thread
 * only. Cooldowns survive relogging (they live for the server's uptime), so logging out never
 * resets one.
 */
public final class SpellState {

  private final Timers<CooldownKey> cooldowns = new Timers<>();
  private final Timers<UUID> silences = new Timers<>();
  private final Timers<UUID> stealth = new Timers<>();
  private final Timers<UUID> featherFall = new Timers<>();
  private final Timers<UUID> timeShifts = new Timers<>();
  private final Wards wards = new Wards();
  private final Foci foci = new Foci();
  private boolean ready;

  public Timers<CooldownKey> cooldowns() {
    return cooldowns;
  }

  /** Players who may not cast. */
  public Timers<UUID> silences() {
    return silences;
  }

  /** Players hidden by Stealth; attacking ends it. */
  public Timers<UUID> stealth() {
    return stealth;
  }

  /** Players protected from fall damage after Leap until they land. */
  public Timers<UUID> featherFall() {
    return featherFall;
  }

  /** Players whose sky Dawn or Dusk shifted; reset when the timer ends. */
  public Timers<UUID> timeShifts() {
    return timeShifts;
  }

  public Wards wards() {
    return wards;
  }

  public Foci foci() {
    return foci;
  }

  /** False until Marks and focus bindings have loaded after a start. */
  public boolean ready() {
    return ready;
  }

  void markReady() {
    ready = true;
  }
}
