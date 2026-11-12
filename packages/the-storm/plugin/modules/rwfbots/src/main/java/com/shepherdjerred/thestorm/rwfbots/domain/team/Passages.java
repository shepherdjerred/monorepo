package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Situation;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsContext;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * How a pair uses a side passage, and where a waiting team stands while two other teams fight. One
 * aggressive bot, the lowest living id, may take the cut at once. Everyone else lets the main push
 * be seen for {@link #CUT_WAIT} ticks. A quiet cut is watched from home.
 */
public final class Passages {

  /** Ticks a cut pair waits after the deal so the main push is seen (2 s). */
  public static final int CUT_WAIT = 40;

  /** The lowest living id takes the cut at once at or above this aggression. */
  public static final double RUSH_AGGRESSION = 0.55;

  /** A known enemy this close to the cut, in blocks, keeps the home anchor on its mouth. */
  public static final double QUIET = 14;

  /** Where a waiting cutter stands, as a fraction of the cut from home. */
  public static final double MOUTH = 0.05;

  /** How far from a two-team fight a waiting bot stands, in blocks. */
  public static final double EDGE = 12;

  /** An enemy within this of a different other team is in that fight, in blocks. */
  public static final double FIGHT = 8;

  private static final double[] SAMPLES = {0.2, 0.5, 0.8};

  private Passages() {}

  /** Whether {@code self} is the one bot allowed to enter the cut immediately. */
  public static boolean rushes(CombatantId self, List<CombatantId> living, double aggression) {
    if (living.isEmpty() || aggression < RUSH_AGGRESSION) {
      return false;
    }
    var lowest = living.stream().min(Comparator.naturalOrder()).orElseThrow();
    return self.equals(lowest);
  }

  /** Whether {@code lane} is a cut the bot should still be staging at, not pushing. */
  public static boolean waiting(Situation situation, TacticsContext context, Lane lane) {
    if (!lane.cut()) {
      return false;
    }
    var dealt = situation.board().plan().dealtTick();
    if (dealt < 0 || situation.now() - dealt >= CUT_WAIT) {
      return false;
    }
    var living =
        situation.snapshot().alive(situation.self().team()).stream()
            .map(CombatantView::id)
            .toList();
    return !rushes(situation.self().id(), living, context.style().aggression());
  }

  /** Whether no known enemy is near the cut. The home anchor then returns to the bomb. */
  public static boolean quiet(Situation situation, Lane cut) {
    for (var sample : SAMPLES) {
      var at = cut.at(sample);
      for (var enemy : situation.knownEnemies()) {
        if (enemy.pos().distance(at) <= QUIET) {
          return false;
        }
      }
    }
    return true;
  }

  /** The team's own bomb nearest home, where a quiet cut anchor stands. */
  public static Optional<Vec3> homeBomb(Situation situation) {
    var bombs = situation.ownBombs();
    if (bombs.isEmpty()) {
      return Optional.empty();
    }
    var from = situation.board().plan().home().orElseGet(() -> situation.self().pos());
    return bombs.stream()
        .min(Comparator.comparingDouble(bomb -> bomb.pos().distance(from)))
        .map(BombView::pos);
  }

  /**
   * A point about {@link #EDGE} blocks off a fight between two other teams, toward this bot and not
   * at spawn. Empty unless the team is waiting and this bot is following that.
   */
  public static Optional<Vec3> edge(Situation situation) {
    if (situation.board().plan().posture().orElse(Posture.PRESS) != Posture.WAIT) {
      return Optional.empty();
    }
    if (situation.board().plan().reckless().contains(situation.self().id())) {
      return Optional.empty();
    }
    var cluster = cluster(situation);
    if (cluster.size() < 2) {
      return Optional.empty();
    }
    var centroid = centroid(cluster);
    var away = situation.self().pos().minus(centroid).horizontal();
    if (away.isZero() || away.length() < 0.01) {
      away = new Vec3(1, 0, 0);
    }
    var direction = away.normalized();
    var edge = centroid.plus(direction.scale(EDGE));
    var home = situation.board().plan().home();
    if (home.isPresent() && edge.horizontalDistance(home.orElseThrow()) < EDGE) {
      edge = centroid.plus(new Vec3(-direction.z(), 0, direction.x()).scale(EDGE));
    }
    return Optional.of(edge);
  }

  private static List<Vec3> cluster(Situation situation) {
    var known = situation.knownEnemies();
    var out = new ArrayList<Vec3>();
    for (var enemy : known) {
      var team = situation.snapshot().combatant(enemy.id()).map(CombatantView::team);
      if (team.isEmpty()) {
        continue;
      }
      var fighting =
          known.stream()
              .filter(other -> !other.id().equals(enemy.id()))
              .anyMatch(other -> {
                var otherTeam = situation.snapshot().combatant(other.id()).map(CombatantView::team);
                return otherTeam.isPresent()
                    && !otherTeam.orElseThrow().equals(team.orElseThrow())
                    && other.pos().distance(enemy.pos()) <= FIGHT;
              });
      if (fighting) {
        out.add(enemy.pos());
      }
    }
    return out;
  }

  private static Vec3 centroid(List<Vec3> points) {
    var sum = Vec3.ZERO;
    for (var point : points) {
      sum = sum.plus(point);
    }
    return sum.scale(1.0 / points.size());
  }
}
