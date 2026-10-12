package com.shepherdjerred.thestorm.rwfbots.sim;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Measures whether a team moves up the field like a side, from the start of a sim match to first
 * contact (the first sword blow or death): how wide it spreads across the yard at 8 s and at
 * contact, how many of its non-anchor bots cross their own third, and how much it walks for the
 * ground it gains (orbiting walks a lot and gains nothing).
 */
final class Advance {

  /** When the lateral spread is first taken: 8 s. */
  static final long SPREAD_TICK = 160;

  /** The second yardstick for forward progress: 10 s. */
  static final long BY = 200;

  /** How far from its spawn a bot has crossed its own third of the yard. */
  static final double THIRD = 20;

  /** Path length is sampled this often, so standing jitter does not count as walking. */
  static final long SAMPLE_TICKS = 10;

  private final SimWorld world;
  private final Map<CombatantId, Vec3> start = new HashMap<>();
  private final Map<CombatantId, Vec3> last = new HashMap<>();
  private final Map<CombatantId, Double> walked = new HashMap<>();
  private final Map<CombatantId, Double> furthest = new HashMap<>();
  private final Map<TeamId, Double> spreadAt8 = new HashMap<>();
  private final Map<TeamId, Double> spreadAtContact = new HashMap<>();
  private final Map<CombatantId, SlotKind> kinds = new HashMap<>();
  private final Map<CombatantId, Double> contactFurthest = new HashMap<>();
  private final Map<CombatantId, Double> contactWalked = new HashMap<>();
  private final Map<CombatantId, Vec3> contactLast = new HashMap<>();
  private final Map<CombatantId, Double> byFurthest = new HashMap<>();
  private Optional<Long> contact = Optional.empty();

  Advance(SimWorld world) {
    this.world = world;
  }

  /** Records the current tick; stops the match once first contact and {@link #BY} have passed. */
  boolean observe(SimWorld unused) {
    if (world.boards.isEmpty()) {
      return false;
    }
    var tick = world.tick;
    if (contact.isEmpty()) {
      for (var body : world.bodies.values()) {
        var struck = body.lastCommands.stream().anyMatch(BodyCommand.Attack.class::isInstance);
        if (!body.alive || struck) {
          contact = Optional.of(tick);
          spreadAtContact.putAll(spread());
          sample();
          contactFurthest.putAll(furthest);
          contactWalked.putAll(walked);
          contactLast.putAll(last);
        }
      }
    }
    if (tick == SPREAD_TICK) {
      spreadAt8.putAll(spread());
    }
    if (tick % SAMPLE_TICKS == 0) {
      sample();
    }
    if (tick == BY) {
      byFurthest.putAll(furthest);
    }
    return contact.isPresent() && tick >= BY;
  }

  private void sample() {
    for (var body : world.bodies.values()) {
      start.putIfAbsent(body.id, body.pos);
      var previous = last.put(body.id, body.pos);
      if (previous != null) {
        walked.merge(body.id, previous.horizontalDistance(body.pos), Double::sum);
      }
      furthest.merge(body.id, Math.abs(body.pos.x() - start.get(body.id).x()), Math::max);
      world
          .boards
          .get(body.team)
          .plan()
          .slotOf(body.id)
          .ifPresent(slot -> kinds.put(body.id, slot.kind()));
    }
  }

  private Map<TeamId, Double> spread() {
    var out = new HashMap<TeamId, Double>();
    var low = new HashMap<TeamId, Double>();
    for (var body : world.bodies.values()) {
      if (body.alive) {
        low.merge(body.team, body.pos.z(), Math::min);
        out.merge(body.team, body.pos.z(), Math::max);
      }
    }
    out.replaceAll((team, high) -> high - low.get(team));
    return out;
  }

  /** The tick of first contact, if the match got there. */
  Optional<Long> contact() {
    return contact;
  }

  /** {@code team}'s z-range at 8 s. */
  double spreadAt8(TeamId team) {
    return spreadAt8.getOrDefault(team, 0.0);
  }

  /** {@code team}'s z-range at first contact. */
  double spreadAtContact(TeamId team) {
    return spreadAtContact.getOrDefault(team, 0.0);
  }

  /** The share of {@code team}'s non-anchor bots that got {@link #THIRD} from spawn by contact. */
  double forward(TeamId team) {
    return crossed(team, contactFurthest);
  }

  /**
   * The share of {@code team}'s non-anchor bots that got {@link #THIRD} from spawn by {@link #BY}.
   */
  double forwardBy(TeamId team) {
    return crossed(team, byFurthest);
  }

  private double crossed(TeamId team, Map<CombatantId, Double> reach) {
    var bots = 0;
    var crossed = 0;
    for (var body : world.bodies.values()) {
      if (!body.team.equals(team) || kinds.get(body.id) == SlotKind.ANCHOR) {
        continue;
      }
      bots++;
      if (reach.getOrDefault(body.id, 0.0) >= THIRD) {
        crossed++;
      }
    }
    return (double) crossed / bots;
  }

  /** {@code team}'s summed path length over its summed displacement from spawn, by contact. */
  double winding(TeamId team) {
    var path = 0.0;
    var gained = 0.0;
    for (var body : world.bodies.values()) {
      if (body.team.equals(team) && contactLast.containsKey(body.id)) {
        path += contactWalked.getOrDefault(body.id, 0.0);
        gained += start.get(body.id).horizontalDistance(contactLast.get(body.id));
      }
    }
    return gained == 0 ? Double.POSITIVE_INFINITY : path / gained;
  }
}
