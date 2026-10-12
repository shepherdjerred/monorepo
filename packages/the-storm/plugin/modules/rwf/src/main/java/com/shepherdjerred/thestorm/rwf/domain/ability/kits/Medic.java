// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/MedicAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Legacy;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The Medic's wand heals every ally within 5 blocks by 7 less their distance, less one for every
 * allied Medic within 8 blocks (the Medic counting itself). Each ally may be given 50 health in all
 * by every Medic together; after that a wave only grants Regeneration I. A Medic waits {@code
 * healed × 300 ms} before healing the same ally again. Medics and Sacrificials are never healed,
 * nor are poisoned allies. Healing more than 3 lets a hurt Medic mend a point of its own.
 *
 * <p>Healing is off in small games, where {@link #SMALL_GAME} or fewer players were on the server
 * as the match went live (Red Warfare counted every player online when its abilities registered),
 * and once the poison has begun. A small game's Medics are told so a second after it goes live. A
 * Medic who dies or lives to the end is told how much it healed.
 */
public final class Medic implements Ability {

  public static final String ID = "medic";

  /** Healing is off when this many players or fewer were online as the match went live. */
  public static final int SMALL_GAME = 20;

  /** How far the wand reaches. */
  public static final double REACH = 5;

  /** Allied Medics within this many blocks weaken each heal by one. */
  public static final double CROWD = 8;

  /** The health one ally may be given in all, by every Medic together. */
  public static final double LIMIT = 50;

  public static final Duration PER_POINT = Duration.ofMillis(300);

  public static final int REGEN_TICKS = 50;

  /** A small game's Medics are told their heals are off this long after it goes live: 20 ticks. */
  public static final Duration WARN_AFTER = Duration.ofSeconds(1);

  /** Healing more than this in one wave lets a hurt Medic mend itself. */
  public static final double SELF_MEND_AFTER = 3;

  /** A Medic who healed this much or less in all is scolded. */
  public static final double SCOLD_AT = 5;

  /** Kits a Medic never heals. */
  public static final Set<String> UNHEALABLE = Set.of(ID, "sacrificial");

  /**
   * One Medic's work this match.
   *
   * @param healed health it has given in all
   * @param warnAt when to tell it a small game's heals are off, until it has been told
   */
  public record State(double healed, Optional<Instant> warnAt) implements KitState {}

  /**
   * What every Medic has given each ally, together.
   *
   * @param given ally to health given
   */
  public record Given(Map<CombatantId, Double> given) implements KitState {

    public Given {
      given = Map.copyOf(given);
    }

    double of(CombatantId id) {
      return given.getOrDefault(id, 0.0);
    }

    Given with(CombatantId id, double total) {
      var next = new HashMap<>(given);
      next.put(id, total);
      return new Given(next);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  /** Whether healing is off this match: too few players were online as it went live. */
  public static boolean smallGame(Arena arena) {
    return arena.online() <= SMALL_GAME;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    return new State(
        0, smallGame(arena) ? Optional.of(arena.now().plus(WARN_AFTER)) : Optional.empty());
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    var state = arena.state(self.id(), State.class);
    if (state.warnAt().filter(at -> !arena.now().isBefore(at)).isPresent()) {
      arena.say(
          self.id(),
          Legacy.GOLD + "As this is a small game, your heals are disabled!",
          AbilityEffect.Tone.LEGACY);
      arena.state(self.id(), new State(state.healed(), Optional.empty()));
    }
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof AbilityInput.Heal heal) || smallGame(arena) || arena.endgame()) {
      return;
    }
    var round =
        new Round(
            self,
            heal.nearbyMedics(),
            arena,
            arena.shared(ID, Given.class).orElseGet(() -> new Given(Map.of())));
    for (var patient : heal.patients()) {
      arena
          .fighter(patient.id())
          .filter(ally -> healable(self, ally, patient, arena))
          .ifPresent(ally -> round.treat(ally, patient));
    }
    arena.shared(ID, round.given);
    var healed = round.healed;
    if (healed > SELF_MEND_AFTER && heal.health() * 1.2 < heal.maxHealth()) {
      arena.effect(
          new AbilityEffect.Heal(self.id(), Math.min(1, heal.maxHealth() - heal.health())));
    }
    if (healed >= 1) {
      var hearts = (int) Math.round(healed / 2);
      arena.say(
          self.id(),
          Legacy.BLUE + "Healed " + hearts + " heart" + (hearts == 1 ? "" : "s") + "!",
          AbilityEffect.Tone.LEGACY);
    }
    var state = arena.state(self.id(), State.class);
    arena.state(self.id(), new State(state.healed() + healed, state.warnAt()));
  }

  private static boolean healable(
      Fighter self, Fighter ally, AbilityInput.Patient patient, Arena arena) {
    return !ally.id().equals(self.id())
        && ally.alive()
        && ally.allyOf(self)
        && !UNHEALABLE.contains(ally.kit())
        && patient.health() > 0
        && patient.health() < patient.maxHealth()
        && !patient.poisoned()
        && arena.ready(self.id(), cooldown(patient.id()));
  }

  /** One wave of the wand: what it has given so far, and to whom. */
  private static final class Round {

    private final Fighter medic;
    private final int nearbyMedics;
    private final Arena arena;
    private Given given;
    private double healed;

    Round(Fighter medic, int nearbyMedics, Arena arena, Given given) {
      this.medic = medic;
      this.nearbyMedics = nearbyMedics;
      this.arena = arena;
      this.given = given;
    }

    /** Heals {@code patient} as Red Warfare did: less the further and the more crowded. */
    void treat(Fighter ally, AbilityInput.Patient patient) {
      var amount = 7 - patient.distance() - nearbyMedics;
      var before = given.of(patient.id());
      if (amount <= 0) {
        given = given.with(patient.id(), before + 0.2);
        if (before <= 0) {
          outOfHeals(medic, ally, arena);
        }
        return;
      }
      var toHeal = Math.min(patient.maxHealth() - patient.health(), amount);
      if (before >= LIMIT) {
        arena.effect(new AbilityEffect.Cue(patient.id(), KitCue.HEALS_SPENT));
        if (!patient.regenerating()) {
          arena.effect(
              new AbilityEffect.Potion(
                  patient.id(), "regeneration", 0, REGEN_TICKS, Optional.of(medic.id())));
        }
        arena.use(medic.id(), cooldown(patient.id()), recharge(toHeal), false);
        return;
      }
      var after = before + toHeal;
      given = given.with(patient.id(), after);
      if (after >= LIMIT) {
        toHeal += LIMIT - after;
      }
      if (toHeal > 0) {
        give(patient, toHeal);
      }
    }

    private void give(AbilityInput.Patient patient, double toHeal) {
      healed += toHeal;
      arena.effect(new AbilityEffect.Heal(patient.id(), toHeal));
      if (toHeal >= 1) {
        arena.effect(new AbilityEffect.Cue(patient.id(), KitCue.HEALED));
        arena.say(
            patient.id(),
            Legacy.BLUE + medic.name() + " has healed you!",
            AbilityEffect.Tone.LEGACY);
      }
      arena.use(medic.id(), cooldown(patient.id()), recharge(toHeal), false);
    }
  }

  private static void outOfHeals(Fighter medic, Fighter ally, Arena arena) {
    arena.say(ally.id(), Legacy.BLUE + "You have run out of heals!", AbilityEffect.Tone.LEGACY);
    // Red Warfare named the Medic itself here, not the ally.
    arena.say(
        medic.id(),
        Legacy.BLUE + medic.name() + " has run out of heals!",
        AbilityEffect.Tone.LEGACY);
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (!death.victim().equals(self.id()) || death.cause().has(AttackType.Flag.INSTANT_DEATH)) {
      return;
    }
    scold(self, arena);
  }

  @Override
  public void ended(Fighter self, Arena arena) {
    scold(self, arena);
  }

  /** How the Medic did this match, as Red Warfare's {@code scoldPlayer} told it. */
  private static void scold(Fighter self, Arena arena) {
    var healed = arena.state(self.id(), State.class).healed();
    if (healed <= SCOLD_AT) {
      arena.say(
          self.id(),
          Legacy.GOLD + "You need to improve your medic skills, heal more people!",
          AbilityEffect.Tone.LEGACY);
      return;
    }
    var hearts = (int) (healed / 2);
    arena.say(
        self.id(),
        Legacy.GOLD + "You healed " + hearts + " heart" + (hearts == 1 ? "" : "s") + " this round!",
        AbilityEffect.Tone.LEGACY);
  }

  /** The cooldown key for healing {@code ally} again. */
  public static String cooldown(CombatantId ally) {
    return "heal:" + ally.uuid();
  }

  private static Duration recharge(double toHeal) {
    return Duration.ofMillis((long) (toHeal * PER_POINT.toMillis()));
  }
}
