package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * What an ability sees and may change while one match event is applied: the combatants, every
 * holder's state and cooldowns, the things kits have placed, and the effects to carry out. It lives
 * only for that event.
 */
public interface Arena {

  Instant now();

  /** The match's randomness for this event, from its seed. */
  RandomGenerator random();

  /** The combatant with {@code id}, once they are on a team. */
  Optional<Fighter> fighter(CombatantId id);

  /** Everyone on a team and still alive. */
  List<Fighter> living();

  /** How many combatants the match went live with. */
  int fielded();

  /** How many players were on the server when the match went live. */
  int online();

  /** Whether the end-of-game poison has begun. */
  boolean endgame();

  /** Where {@code id} stood at the last tick. */
  Optional<Vec3> position(CombatantId id);

  /** The blocks of the bombs still on the map. */
  List<BlockPos> bombs();

  /**
   * Whether someone sent to {@code feet} would land safely, as the map's blocks stand this tick.
   * Only a tick reads the ground; asking during any other event fails.
   */
  boolean safe(Vec3 feet);

  /** {@code id}'s state, which must be a {@code type}. */
  <S extends KitState> S state(CombatantId id, Class<S> type);

  /** Replaces {@code id}'s state. */
  void state(CombatantId id, KitState state);

  /** What ability {@code ability} remembers across its holders, which must be a {@code type}. */
  <S extends KitState> Optional<S> shared(String ability, Class<S> type);

  /** Replaces what ability {@code ability} remembers across its holders. */
  void shared(String ability, KitState state);

  /** Whether {@code id}'s cooldown {@code key} has run out (or never started). */
  boolean ready(CombatantId id, String key);

  /** How long until {@code id}'s cooldown {@code key} runs out; zero when ready. */
  Duration left(CombatantId id, String key);

  /**
   * Starts {@code id}'s cooldown {@code key} for {@code length}; {@code shown} puts it on their
   * experience bar.
   */
  void use(CombatantId id, String key, Duration length, boolean shown);

  /** Everything kits have placed, oldest first. */
  List<Placed> placed();

  void place(Placed placed);

  void unplace(Placed placed);

  /** Replaces {@code before} with {@code after}, keeping its place in the order. */
  void replace(Placed before, Placed after);

  void effect(AbilityEffect effect);

  default void say(CombatantId to, String text, AbilityEffect.Tone tone) {
    effect(new AbilityEffect.Say(List.of(to), text, tone));
  }

  default void say(List<CombatantId> to, String text, AbilityEffect.Tone tone) {
    if (!to.isEmpty()) {
      effect(new AbilityEffect.Say(to, text, tone));
    }
  }

  /** The living combatants on {@code fighter}'s team, {@code fighter} included. */
  default List<Fighter> allies(Fighter fighter) {
    return living().stream().filter(other -> other.team() == fighter.team()).toList();
  }

  /** The living combatants on other teams than {@code fighter}'s. */
  default List<Fighter> enemies(Fighter fighter) {
    return living().stream().filter(other -> other.team() != fighter.team()).toList();
  }
}
