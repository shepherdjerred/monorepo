package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.SummonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;

/**
 * One tick's input to the reflex layer.
 *
 * @param self the bot's own view
 * @param snapshot the world
 * @param decision the standing decision from the think step
 * @param target the enemy to fight right now, if one is visible
 * @param gapplesLeft golden apples in the inventory
 * @param perceived every enemy the bot perceives this tick, target or not, nearest first; never one
 *     it cannot see, so nothing reacts to a player hidden behind a wall or invisible
 * @param threat where the nearest enemy in contact is, seen or just felt or heard there ({@link
 *     #threat}): the bot faces it whatever else it does
 */
public record ReflexInput(
    CombatantView self,
    WorldSnapshot snapshot,
    Decision decision,
    Optional<CombatantView> target,
    int gapplesLeft,
    List<CombatantView> perceived,
    Optional<Vec3> threat) {

  /**
   * An enemy this close is in contact. In production bots within 3.5 blocks of their nearest enemy
   * faced more than 90 degrees away from it 19% of the time: walking past it, or fighting another.
   */
  public static final double CONTACT = 3.5;

  /** An enemy the bot felt or heard in contact counts for this long after, in ticks. */
  public static final long CONTACT_MEMORY_TICKS = 20;

  /** No bot without a shot stands closer than this to a hostile golem, in blocks. */
  public static final double GOLEM_KEEP_AWAY = 6;

  /** A bow takes on a hostile golem within this distance. */
  public static final double GOLEM_SHOT = 16;

  public ReflexInput {
    if (gapplesLeft < 0) {
      throw new IllegalArgumentException("gapples must not be negative");
    }
    perceived = List.copyOf(perceived);
  }

  /**
   * The input for {@code self} given what it perceives, with {@code gapplesLeft} apples: the
   * decided target when visible, otherwise only an enemy close enough to hit back at, the one that
   * just hurt the bot first, else a hostile killstreak creature ({@link #resolveSummon}). Whether
   * to fight anyone further away is the think step's call, so a bot holding its slot never charges.
   */
  public static ReflexInput of(
      CombatantView self, WorldSnapshot snapshot, Decision decision, Percept percept) {
    return new ReflexInput(
        self,
        snapshot,
        decision,
        resolveTarget(self, decision, percept),
        0,
        percept.visible(),
        threat(self, percept));
  }

  /**
   * Where the nearest enemy in {@link #CONTACT} is: one in sight, else one the bot placed there in
   * the last {@link #CONTACT_MEMORY_TICKS}, by the blow it struck (exactly) or the sound it made. A
   * player struck from behind knows where the blow came from and turns to it.
   */
  static Optional<Vec3> threat(CombatantView self, Percept percept) {
    var seen = contact(self, percept.visible());
    if (seen.isPresent()) return seen;
    var now = percept.tick();
    return percept.state().memory().sightings().values().stream()
        .filter(sighting -> now - sighting.tick() <= CONTACT_MEMORY_TICKS)
        .map(sighting -> sighting.predictedPos(now))
        .filter(pos -> pos.horizontalDistance(self.pos()) <= CONTACT)
        .min(java.util.Comparator.comparingDouble(pos -> pos.horizontalDistance(self.pos())));
  }

  /**
   * The enemy in {@link #CONTACT} the bot fights first: the one that just hurt it, else the
   * nearest.
   */
  private static Optional<CombatantView> inFace(CombatantView self, Percept percept) {
    var near =
        percept.visible().stream()
            .filter(enemy -> enemy.pos().horizontalDistance(self.pos()) <= CONTACT)
            .toList();
    var attacker =
        percept
            .state()
            .grudgeAt(percept.tick())
            .flatMap(
                grudge ->
                    near.stream()
                        .filter(enemy -> enemy.id().equals(grudge.attacker()))
                        .findFirst());
    return attacker.or(() -> near.stream().findFirst());
  }

  private static Optional<Vec3> contact(CombatantView self, List<CombatantView> perceived) {
    return perceived.stream()
        .map(CombatantView::pos)
        .filter(pos -> pos.horizontalDistance(self.pos()) <= CONTACT)
        .min(java.util.Comparator.comparingDouble(pos -> pos.horizontalDistance(self.pos())));
  }

  /** The enemy {@code self} should fight this tick, if any. */
  public static Optional<CombatantView> resolveTarget(
      CombatantView self, Decision decision, Percept percept) {
    if (decision.option() == com.shepherdjerred.thestorm.rwfbots.domain.world.Option.DEFUSE) {
      var immediate =
          percept
              .nearestVisible()
              .filter(enemy -> enemy.pos().distance(self.pos()) <= Reflex.REACH + 0.5);
      if (immediate.isPresent()) return immediate;
    }
    var decided = decision.target().flatMap(percept::visible);
    if (decided.isPresent()) {
      // A bot fights an enemy in its face before one the think step chose further off: it would
      // otherwise turn its back on a blow to chase the other.
      return decided
          .filter(
              chosen ->
                  decision.stance() == Stance.EVASIVE
                      || chosen.pos().distance(self.pos()) <= Reflex.MELEE_ALERT)
          .or(() -> inFace(self, percept))
          .or(() -> decided);
    }
    if (decision.stance() != Stance.EVASIVE) {
      var face = inFace(self, percept);
      if (face.isPresent()) return face;
    }
    var reach = reach(decision);
    // Of the enemies in reach, the one that just hurt the bot comes first.
    var attacker =
        percept
            .state()
            .grudgeAt(percept.tick())
            .flatMap(grudge -> percept.visible(grudge.attacker()))
            .filter(enemy -> enemy.pos().distance(self.pos()) <= reach);
    if (attacker.isPresent()) {
      return attacker;
    }
    return percept
        .nearestVisible()
        .filter(enemy -> enemy.pos().distance(self.pos()) <= defended(self, decision, enemy, reach))
        .or(() -> resolveSummon(self, decision, percept).map(SummonView::asTarget));
  }

  /**
   * How close {@code enemy} may come before {@code self} fights it: {@code reach}, or for a bow kit
   * not running from the fight, a sword inside {@link BowSpacing#SWORD_NEAR}. It is shot as the
   * archer goes rather than met with its sword at arm's length.
   */
  private static double defended(
      CombatantView self, Decision decision, CombatantView enemy, double reach) {
    return self.kit().hasBow() && decision.stance() != Stance.EVASIVE && BowSpacing.sword(enemy)
        ? Math.max(reach, BowSpacing.SWORD_NEAR)
        : reach;
  }

  /**
   * The hostile killstreak creature {@code self} fights when no player needs it, if any: a dog in
   * the same reach a player would be fought at; a golem only with a bow, out of its reach and
   * within {@link #GOLEM_SHOT}, or to keep it in view and fend it off while the bot runs from it.
   * Of those, the one that just bit the bot comes first.
   */
  public static Optional<SummonView> resolveSummon(
      CombatantView self, Decision decision, Percept percept) {
    var fightable =
        percept.summons().stream().filter(summon -> fights(self, decision, summon)).toList();
    var attacker =
        percept
            .state()
            .grudgeAt(percept.tick())
            .flatMap(
                grudge ->
                    fightable.stream()
                        .filter(summon -> summon.id().equals(grudge.attacker()))
                        .findFirst());
    return attacker.or(() -> fightable.stream().findFirst());
  }

  private static boolean fights(CombatantView self, Decision decision, SummonView summon) {
    var distance = summon.pos().distance(self.pos());
    return switch (summon.kind()) {
      case WOLF -> distance <= reach(decision);
      case GOLEM ->
          (self.kit().hasBow() && distance > GOLEM_KEEP_AWAY && distance <= GOLEM_SHOT)
              || (decision.stance() == Stance.EVASIVE && distance <= GOLEM_KEEP_AWAY);
    };
  }

  private static double reach(Decision decision) {
    return switch (decision.stance()) {
      case AGGRESSIVE, CAUTIOUS -> Reflex.MELEE_ALERT;
      case STEALTH, EVASIVE -> Reflex.REACH;
    };
  }

  public ReflexInput withGapples(int count) {
    return new ReflexInput(self, snapshot, decision, target, count, perceived, threat);
  }
}
