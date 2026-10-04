package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static java.util.Comparator.comparingDouble;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Perception;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;

/**
 * Everything one bot knows when it thinks: itself, the world, what it perceives, what the team has
 * shared, and its role.
 */
public record Situation(
    CombatantView self, WorldSnapshot snapshot, Percept percept, Blackboard board, Role role) {

  /** Confidence given to a teammate's report. */
  static final double SHARED_CONFIDENCE = 0.5;

  /**
   * An enemy the bot knows about.
   *
   * @param id who
   * @param pos where, predicted to now
   * @param confidence how sure, 0..1
   * @param visible whether seen this tick
   */
  public record KnownEnemy(CombatantId id, Vec3 pos, double confidence, boolean visible) {}

  public long now() {
    return snapshot.tick();
  }

  /** Known enemies from sight, memory and the blackboard, nearest first. */
  public List<KnownEnemy> knownEnemies() {
    var known = new HashMap<CombatantId, KnownEnemy>();
    for (var view : percept.visible()) {
      known.put(view.id(), new KnownEnemy(view.id(), view.pos(), 1, true));
    }
    percept
        .state()
        .memory()
        .sightings()
        .forEach(
            (id, sighting) -> {
              var confidence = sighting.confidenceAt(now(), Perception.TAU_TICKS);
              if (!known.containsKey(id) && isAlive(id)) {
                known.put(id, new KnownEnemy(id, sighting.predictedPos(now()), confidence, false));
              }
            });
    for (var shared : board.visibleSightings(now())) {
      var existing = known.get(shared.enemy());
      var age = now() - shared.seenTick();
      var confidence = SHARED_CONFIDENCE * Math.exp(-age / Perception.TAU_TICKS);
      if ((existing == null || existing.confidence() < confidence) && isAlive(shared.enemy())) {
        known.put(shared.enemy(), new KnownEnemy(shared.enemy(), shared.pos(), confidence, false));
      }
    }
    var list = new ArrayList<>(known.values());
    list.sort(comparingDouble(enemy -> enemy.pos().distanceSquared(self.pos())));
    return list;
  }

  private boolean isAlive(CombatantId id) {
    return snapshot.combatant(id).map(CombatantView::alive).orElse(false);
  }

  public Optional<KnownEnemy> nearestEnemy() {
    var known = knownEnemies();
    return known.isEmpty() ? Optional.empty() : Optional.of(known.getFirst());
  }

  public List<BombView> ownBombs() {
    return snapshot.bombsOf(self.team());
  }

  public List<BombView> armableBombs() {
    return snapshot.bombsArmableBy(self.team());
  }

  /** The own bomb with a lit fuse, if any. */
  public Optional<BombView> litOwnBomb() {
    return ownBombs().stream().filter(bomb -> bomb.state().isLit()).findFirst();
  }

  /** A bomb a teammate is arming right now. */
  public Optional<BombView> bombBeingArmedByUs() {
    return snapshot.bombs().stream()
        .filter(
            bomb ->
                bomb.state() instanceof BombState.Arming(var team, var _, var _)
                    && team.equals(self.team()))
        .findFirst();
  }

  /** The nearest bomb we may arm. */
  public Optional<BombView> nearestArmableBomb() {
    return armableBombs().stream()
        .min(comparingDouble(bomb -> bomb.pos().distanceSquared(self.pos())));
  }

  public Optional<BombView> nearestOwnBomb() {
    return ownBombs().stream().min(comparingDouble(bomb -> bomb.pos().distanceSquared(self.pos())));
  }

  public List<CombatantView> livingAllies() {
    return snapshot.alive(self.team()).stream()
        .filter(view -> !view.id().equals(self.id()))
        .toList();
  }

  public boolean isLastAlive() {
    return livingAllies().isEmpty();
  }

  /** The teammate holding {@link Role#PLANT}, if alive. */
  public Optional<CombatantView> planter() {
    return board.holders(Role.PLANT).stream()
        .filter(id -> !id.equals(self.id()))
        .map(snapshot::combatant)
        .flatMap(Optional::stream)
        .filter(CombatantView::alive)
        .findFirst();
  }
}
