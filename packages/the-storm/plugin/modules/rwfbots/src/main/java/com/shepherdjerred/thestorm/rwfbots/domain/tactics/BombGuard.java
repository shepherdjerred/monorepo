package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static java.util.Comparator.comparing;
import static java.util.Comparator.comparingDouble;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Sighting;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * A bomb's guards answer an enemy on its way to the bomb, not only one already beside it. Guards
 * used to react only to an enemy within {@link Features#BOMB_THREAT_RANGE} of the bomb, while
 * anchors stand 10 to 14 blocks out, so an attacker was often level with them before anyone moved.
 */
final class BombGuard {

  /** An enemy this close to an own bomb, and not moving away from it, calls its guards. */
  static final double GUARD_RANGE = 28;

  /** A remembered enemy older than this, in ticks (3 s), no longer calls the guards. */
  static final long MEMORY_TICKS = 60;

  /** An enemy moving away from the bomb faster than this, in blocks per tick, is leaving. */
  static final double LEAVING_SPEED = 0.02;

  /** How far round the ring from the enemy's bearing each of two responders stands, in radians. */
  static final double SPREAD = 0.5;

  private BombGuard() {}

  /**
   * An enemy approaching {@code bomb}, where the guard last knew it to be, and how many teammates
   * already answer it.
   */
  record Approach(CombatantId enemy, Vec3 pos, BombView bomb, int rank) {

    /** What a plan meeting this approach records. */
    Plan.Answer answer() {
      return new Plan.Answer(enemy, bomb.id(), rank);
    }
  }

  /** A known enemy's position and motion. */
  private record Track(CombatantId id, Vec3 pos, Vec3 vel) {}

  /** Whether the bot guards its team's bombs: a defender, a retaker or an anchor. */
  static boolean guards(Situation situation) {
    return situation.role() == Role.DEFEND
        || situation.role() == Role.RETAKE
        || situation.slot().filter(slot -> slot.kind() == SlotKind.ANCHOR).isPresent();
  }

  /**
   * The enemy a guard answers: one it saw or heard itself within {@link #GUARD_RANGE} of an own
   * bomb and not moving away from it, that fewer than {@link Situation#MAX_CHASERS} teammates
   * already answer; the one nearest its bomb first.
   */
  static Optional<Approach> approach(Situation situation) {
    if (!guards(situation)) return Optional.empty();
    var approaches = new ArrayList<Approach>();
    for (var track : tracks(situation)) {
      var rank = situation.board().chasers(track.id(), situation.self().id());
      if (rank >= Situation.MAX_CHASERS) continue;
      situation.ownBombs().stream()
          .filter(bomb -> closing(track, bomb))
          .min(comparingDouble(bomb -> bomb.pos().distance(track.pos())))
          .ifPresent(bomb -> approaches.add(new Approach(track.id(), track.pos(), bomb, rank)));
    }
    return approaches.stream()
        .min(
            comparingDouble((Approach found) -> found.pos().distance(found.bomb().pos()))
                .thenComparing(Approach::enemy));
  }

  private static boolean closing(Track track, BombView bomb) {
    var toBomb = bomb.pos().minus(track.pos()).horizontal();
    if (toBomb.length() > GUARD_RANGE) return false;
    if (toBomb.isZero()) return true;
    return track.vel().horizontal().dot(toBomb.normalized()) >= -LEAVING_SPEED;
  }

  /** Enemies the bot itself sees or recently saw or heard, with how they were moving. */
  private static List<Track> tracks(Situation situation) {
    var now = situation.now();
    var tracks = new ArrayList<Track>();
    for (var view : situation.percept().visible()) {
      tracks.add(new Track(view.id(), view.pos(), view.vel()));
    }
    situation
        .percept()
        .state()
        .memory()
        .sightings()
        .forEach(
            (id, sighting) -> {
              if (remembered(situation, id, sighting, now))
                tracks.add(new Track(id, sighting.predictedPos(now), sighting.vel()));
            });
    tracks.sort(comparing(Track::id));
    return tracks;
  }

  private static boolean remembered(
      Situation situation, CombatantId id, Sighting sighting, long now) {
    return !situation.percept().sees(id)
        && now - sighting.tick() <= MEMORY_TICKS
        && situation.snapshot().combatant(id).map(CombatantView::alive).orElse(false);
  }

  /**
   * Whether a guard plan still fits {@code board} at commit: its enemy has fewer than {@link
   * Situation#MAX_CHASERS} other answers, and a plan made this think ({@code thinkTick}) was made
   * against as many answers as the board now holds, so its side of the ring is still its own.
   * Guards deciding in one cycle all plan against the same board, so without this check several
   * could answer one enemy, or two could take the same side.
   */
  static boolean admitted(Plan plan, CombatantId self, Blackboard board, long thinkTick) {
    if (plan.answer().isEmpty()) return true;
    var answer = plan.answer().orElseThrow();
    var chasers = board.chasers(answer.enemy(), self);
    var fresh = plan.startedTick() == thinkTick;
    return chasers < Situation.MAX_CHASERS && (!fresh || chasers == answer.rank());
  }

  /**
   * Whether a guard plan under way may continue: the bot still guards, its enemy still approaches
   * the bomb it was planned against by {@link #approach}'s rule (alive, seen or recently heard,
   * within {@link #GUARD_RANGE} and not moving away), and fewer than {@link Situation#MAX_CHASERS}
   * teammates already answer it. Once the enemy turns away, leaves range or dies, the plan's
   * interception point is stale and the guard goes back to its post.
   */
  static boolean stillAnswering(Plan plan, Situation situation) {
    return plan.answer()
        .map(
            answer ->
                guards(situation)
                    && approaching(answer, situation)
                    && situation.board().chasers(answer.enemy(), situation.self().id())
                        < Situation.MAX_CHASERS)
        .orElse(true);
  }

  private static boolean approaching(Plan.Answer answer, Situation situation) {
    var bomb =
        situation.ownBombs().stream().filter(view -> view.id().equals(answer.bomb())).findFirst();
    return bomb.isPresent()
        && tracks(situation).stream()
            .filter(track -> track.id().equals(answer.enemy()))
            .anyMatch(track -> closing(track, bomb.orElseThrow()));
  }

  /**
   * Where a guard answering {@code approach} stands: the point of the retake ring round the bomb on
   * the enemy's side, the first responder a little to one side of the enemy's bearing and the
   * second a little to the other. The ring lies well inside an anchor's post, so the answer never
   * takes a guard further from the bomb.
   */
  static Vec3 post(NavGraph graph, Approach approach) {
    var centre = approach.bomb().pos().plus(0, -0.5, 0);
    var bearing = approach.pos().minus(centre).horizontal();
    var angle =
        StrictMath.atan2(bearing.z(), bearing.x()) + (approach.rank() == 0 ? SPREAD : -SPREAD);
    var point =
        centre.plus(
            new Vec3(StrictMath.cos(angle), 0, StrictMath.sin(angle)).scale(Planner.RETAKE_RING));
    var node = graph.nearestNodeWithin(point, Planner.SNAP);
    return node.isPresent() ? graph.feet(node.getAsInt()) : centre;
  }
}
