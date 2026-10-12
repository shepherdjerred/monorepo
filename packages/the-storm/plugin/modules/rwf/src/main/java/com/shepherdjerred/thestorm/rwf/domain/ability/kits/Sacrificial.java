// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// SacrificialAbility.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Abilities;
import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitAttacks;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitText;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.time.Duration;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * The Sacrificial casts sacrifice on allies with its Sacrificial Magic: a bonded ally takes no
 * damage at all, every hit and fall going instead to the Sacrificial, at the amount before the
 * ally's armor and through the Sacrificial's own. A Sacrificial takes four times the damage when
 * someone strikes it directly. On Red Warfare's one-second clock, once its steak has recharged, it
 * gets one more while it holds at most four, or fewer than twenty while it has bonds; its bonded
 * allies are told how many it holds, and warned when that is under five. Its experience level shows
 * how many allies it has bonded. Each of its two shears snips every bond once. Bonds break when
 * either side dies.
 */
public final class Sacrificial implements Ability {

  public static final String ID = "sacrificial";

  /** Direct hits on a Sacrificial are multiplied by this. */
  public static final double DIRECT = 4;

  public static final Duration STEAK = Duration.ofSeconds(20);
  public static final int STEAKS_ALONE = 5;
  public static final int STEAKS_BONDED = 20;
  public static final int SNIPS = 2;

  /** The material of the kit's steaks, which the server counts once a second. */
  public static final String STEAK_MATERIAL = "COOKED_BEEF";

  /** Kits a Sacrificial cannot bond. */
  public static final Set<String> UNBONDABLE = Set.of(ID, Dwarf.ID);

  /**
   * One Sacrificial's bonds.
   *
   * @param bonds the allies it shields
   * @param snipsLeft how many shears it still holds, each snipping once
   */
  public record State(List<CombatantId> bonds, int snipsLeft) implements KitState {

    public State {
      bonds = List.copyOf(bonds);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.effect(new AbilityEffect.Meter(self.id(), 0, -1));
    return new State(List.of(), SNIPS);
  }

  /** The living Sacrificial shielding {@code ally}, if one is. */
  public static Optional<CombatantId> guardian(Abilities abilities, CombatantId ally) {
    for (var entry : abilities.states().entrySet()) {
      if (entry.getValue() instanceof State state && state.bonds().contains(ally)) {
        return Optional.of(entry.getKey());
      }
    }
    return Optional.empty();
  }

  /** Whether {@code type} is damage already sent to a Sacrificial for an ally. */
  public static boolean sacrificed(AttackType type) {
    return KitAttacks.SACRIFICED.name().equals(type.name());
  }

  /** Whether damage of {@code type} passes from a bonded ally to its Sacrificial. */
  public static boolean shields(AttackType type) {
    return !type.has(AttackType.Flag.INSTANT_DEATH)
        && !type.equals(AttackType.VOID)
        && !sacrificed(type);
  }

  /**
   * How damage meant for {@code ally} reaches their Sacrificial, as Red Warfare's {@code
   * cloneData}: the original's kind, without knockback, and a death message naming the ally in
   * their team's colour.
   *
   * @param meant the damage the ally was dealt
   * @param ally the ally's name
   * @param team the ally's team
   */
  public static AttackType sacrificed(AttackType meant, String ally, TeamColor team) {
    var flags = EnumSet.noneOf(AttackType.Flag.class);
    flags.addAll(meant.flags());
    flags.add(AttackType.Flag.NO_KNOCKBACK);
    return new AttackType(
        KitAttacks.SACRIFICED.name(),
        "%Killed% was killed protecting " + KitText.team(team) + ally,
        flags);
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    switch (input) {
      case AbilityInput.Bond bond -> bond(self, bond.ally(), arena);
      case AbilityInput.Sever _ -> sever(self, arena);
      case AbilityInput.Stock stock -> steak(self, stock, arena);
      default -> {}
    }
  }

  private void bond(Fighter self, CombatantId allyId, Arena arena) {
    var ally = arena.fighter(allyId);
    if (ally.isEmpty()) {
      return;
    }
    if (!ally.orElseThrow().allyOf(self)) {
      arena.say(self.id(), "They are not on your team! Run away!", AbilityEffect.Tone.REFUSED);
      return;
    }
    if (!ally.orElseThrow().alive()) {
      return;
    }
    if (UNBONDABLE.contains(ally.orElseThrow().kit())) {
      var kit = KitBook.byId(ally.orElseThrow().kit()).orElseThrow().name();
      arena.say(self.id(), "You cannot sacrifice a " + kit + "!", AbilityEffect.Tone.INFO);
      return;
    }
    var state = arena.state(self.id(), State.class);
    if (state.bonds().contains(allyId)) {
      arena.say(self.id(), "You've already claimed this warrior!", AbilityEffect.Tone.INFO);
      return;
    }
    for (var other : arena.living()) {
      if (other.kit().equals(ID)
          && !other.id().equals(self.id())
          && arena.state(other.id(), State.class).bonds().contains(allyId)) {
        arena.say(
            self.id(),
            "This warrior has already been claimed by another sacrificial!",
            AbilityEffect.Tone.INFO);
        return;
      }
    }
    var bonds = new ArrayList<>(state.bonds());
    bonds.add(allyId);
    arena.state(self.id(), new State(bonds, state.snipsLeft()));
    arena.effect(new AbilityEffect.Meter(self.id(), bonds.size(), -1));
    arena.say(
        self.id(),
        "You have cast sacrifice on " + ally.orElseThrow().name(),
        AbilityEffect.Tone.INFO);
    arena.say(allyId, self.name() + " has cast sacrifice on you!", AbilityEffect.Tone.INFO);
  }

  private void sever(Fighter self, Arena arena) {
    var state = arena.state(self.id(), State.class);
    if (state.snipsLeft() <= 0) {
      return;
    }
    if (state.bonds().isEmpty()) {
      arena.say(self.id(), "You do not have any bonds to sever!", AbilityEffect.Tone.REFUSED);
      return;
    }
    arena.effect(new AbilityEffect.Meter(self.id(), 0, -1));
    for (var allyId : state.bonds()) {
      var name = arena.fighter(allyId).map(Fighter::name).orElse("someone");
      arena.say(
          self.id(), "Snipped the sacrificial bond with " + name + "!", AbilityEffect.Tone.INFO);
      arena.effect(new AbilityEffect.Hear(self.id(), self.id(), KitCue.SNIPPED));
      arena.say(allyId, "Your bond with " + self.name() + " was snipped!", AbilityEffect.Tone.INFO);
      arena.effect(new AbilityEffect.Hear(allyId, self.id(), KitCue.SNIPPED));
    }
    arena.effect(new AbilityEffect.Take(self.id(), "SHEARS", 1));
    arena.state(self.id(), new State(List.of(), state.snipsLeft() - 1));
  }

  /** Red Warfare's once-a-second steak check, given how many steaks are held. */
  private static void steak(Fighter self, AbilityInput.Stock stock, Arena arena) {
    if (!STEAK_MATERIAL.equals(stock.material()) || !arena.ready(self.id(), ID)) {
      return;
    }
    var bonds = arena.state(self.id(), State.class).bonds();
    var held = stock.held();
    if (held >= STEAKS_ALONE && (held >= STEAKS_BONDED || bonds.isEmpty())) {
      return;
    }
    held++;
    arena.effect(new AbilityEffect.Give(self.id(), steak(), Integer.MAX_VALUE));
    arena.use(self.id(), ID, STEAK, true);
    for (var allyId : bonds) {
      arena.say(
          allyId,
          KitText.RED
              + "The sacrificial sacrificing you has "
              + held
              + " steak"
              + (held == 1 ? "" : "s"),
          AbilityEffect.Tone.REFUSED);
      if (held < STEAKS_ALONE) {
        arena.say(
            allyId,
            KitText.RED + "May want to ease up on the fighting warrior!",
            AbilityEffect.Tone.REFUSED);
      }
    }
  }

  /** One of the kit's steaks. */
  public static ItemSpec steak() {
    return KitBook.SACRIFICIAL.hotbar().get(2).times(1);
  }

  @Override
  public DamageFormula.Hit taking(KitState state, DamageFormula.Hit hit, boolean direct) {
    if (!direct || sacrificed(hit.attack())) {
      return hit;
    }
    return hit.times(DIRECT);
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    var state = arena.state(self.id(), State.class);
    if (death.victim().equals(self.id())) {
      for (var allyId : state.bonds()) {
        arena.say(
            allyId,
            "Your bond with " + self.name() + KitText.BLUE + " was severed!",
            AbilityEffect.Tone.INFO);
        arena.effect(new AbilityEffect.Hear(allyId, allyId, KitCue.BOND_BROKEN));
      }
      arena.state(self.id(), new State(List.of(), state.snipsLeft()));
      return;
    }
    if (!state.bonds().contains(death.victim())) {
      return;
    }
    var bonds = new ArrayList<>(state.bonds());
    bonds.remove(death.victim());
    arena.state(self.id(), new State(bonds, state.snipsLeft()));
    var name = arena.fighter(death.victim()).map(Fighter::name).orElse("someone");
    arena.say(self.id(), "Your bond with " + name + " was destroyed!", AbilityEffect.Tone.INFO);
    arena.effect(new AbilityEffect.Hear(self.id(), self.id(), KitCue.BOND_BROKEN));
    arena.effect(new AbilityEffect.Meter(self.id(), bonds.size(), -1));
  }
}
