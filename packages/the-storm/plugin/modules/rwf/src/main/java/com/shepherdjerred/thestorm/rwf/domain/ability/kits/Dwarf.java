// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/DwarfAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;

/**
 * The Dwarf levels its gear by sneaking. Each tick its experience bar fills by 0.005 while it
 * sneaks (a level every 10 seconds, up to {@link #MOST}), and drains by 0.005 while it stands or
 * walks and by 0.02 while it sprints, each loss growing by {@code level × 2%}. Every 3 levels add a
 * level of Sharpness to its weapons (at most V), every 6 a level of Protection to its armour (at
 * most VI) and every 8 a level of Blast Protection (at most VI).
 *
 * <p>Its Slowness follows Red Warfare's {@code onChange} exactly, quirk included. Climbing to a
 * level above 5 sets Slowness with amplifier {@code level − 5}. Dropping from a level above 5 sets
 * it to amplifier {@code old level − 6}, which is the amplifier for the new level less one, and
 * never takes it away: a Dwarf that drops from 6 to 5 keeps Slowness I (amplifier 0) through every
 * level below until it climbs back to 6. Climbing or dropping at level 5 or below never touches it.
 */
public final class Dwarf implements Ability {

  public static final String ID = "dwarf";

  public static final float SNEAK_GAIN = 0.005F;
  public static final float IDLE_LOSS = 0.005F;
  public static final float SPRINT_LOSS = 0.02F;

  /** Each loss grows by this share per level, a {@code double} as Red Warfare multiplied it. */
  public static final double LOSS_PER_LEVEL = 0.02;

  public static final int MOST = 48;

  /** Levels above this slow the Dwarf. */
  public static final int UNSLOWED = 5;

  /** Red Warfare's Slowness length, in ticks: 999999, a little under 14 hours. */
  public static final int SLOWNESS_TICKS = 999_999;

  /**
   * A Dwarf's level and how full its bar is.
   *
   * @param level 0 to {@link #MOST}
   * @param progress 0 to 1
   */
  public record State(int level, float progress) implements KitState {

    public State {
      if (level < 0 || level > MOST) {
        throw new IllegalArgumentException("a dwarf's level is 0-" + MOST + ": " + level);
      }
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.effect(new AbilityEffect.Meter(self.id(), 0, 0));
    return new State(0, 0);
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    var state = arena.state(self.id(), State.class);
    var change = change(motion, state.level());
    if (change < 0 && state.progress() <= 0 && state.level() == 0) {
      return;
    }
    var progress = state.progress() + change;
    var level = state.level();
    if (progress <= 0) {
      if (level > 0) {
        arena.effect(new AbilityEffect.Cue(self.id(), KitCue.LEVEL_DOWN));
        changed(self, level, false, arena);
        level--;
        progress = 1;
      } else {
        progress = 0;
      }
    } else if (progress >= 1) {
      if (level < MOST) {
        level++;
        arena.effect(new AbilityEffect.Cue(self.id(), KitCue.LEVEL_UP));
        changed(self, level, true, arena);
        progress = 0;
      } else {
        progress = 1;
      }
    }
    arena.state(self.id(), new State(level, progress));
    arena.effect(new AbilityEffect.Meter(self.id(), level, progress));
  }

  /**
   * How much of a level {@code motion} gains or loses at {@code level} in a tick, as Red Warfare
   * worked it: a float loss grown by a double product, then narrowed back to a float.
   */
  static float change(Motion motion, int level) {
    float change;
    if (motion.sprinting()) {
      change = -SPRINT_LOSS;
    } else if (motion.sneaking()) {
      change = SNEAK_GAIN;
    } else {
      change = -IDLE_LOSS;
    }
    if (change < 0) {
      change = (float) (change + change * level * LOSS_PER_LEVEL);
    }
    return change;
  }

  /**
   * Red Warfare's {@code onChange}: called with the new level after a climb and with the old level
   * before a drop.
   */
  private static void changed(Fighter self, int level, boolean up, Arena arena) {
    if (level > UNSLOWED) {
      var amplifier = up ? level - UNSLOWED : level - UNSLOWED - 1;
      // Red Warfare replaced the old Slowness outright, so a weaker one never waits behind it.
      arena.effect(new AbilityEffect.ClearPotion(self.id(), "slowness"));
      arena.effect(
          new AbilityEffect.SwirlingPotion(self.id(), "slowness", amplifier, SLOWNESS_TICKS));
    }
    var after = up ? level : level - 1;
    arena.effect(
        new AbilityEffect.Gear(self.id(), sharpness(after), protection(after), blast(after)));
  }

  /** Sharpness at {@code level}: one per 3 levels, at most V. */
  public static int sharpness(int level) {
    return Math.min(5, level / 3);
  }

  /** Protection at {@code level}: one per 6 levels, at most VI. */
  public static int protection(int level) {
    return Math.min(6, level / 6);
  }

  /** Blast Protection at {@code level}: one per 8 levels, at most VI. */
  public static int blast(int level) {
    return Math.min(6, level / 8);
  }
}
