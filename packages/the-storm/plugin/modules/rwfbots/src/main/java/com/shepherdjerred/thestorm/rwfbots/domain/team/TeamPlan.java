package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The positions a team's playbook dealt and who holds each.
 *
 * @param strategy the strategy the slots were dealt for, once dealt
 * @param home where the team starts, if it has been dealt slots
 * @param objective the bomb the team is playing for this deal, if any is left to arm
 * @param lanes the lanes towards the objective (empty without one)
 * @param push how far along the lanes, 0..1, the team has advanced
 * @param slots every slot dealt, one per living bot
 * @param assignment the slot key each bot holds
 * @param dealtTick when the slots were dealt, or -1 before the first deal
 */
public record TeamPlan(
    Optional<Strategy> strategy,
    Optional<Vec3> home,
    Optional<BombId> objective,
    List<Lane> lanes,
    double push,
    List<Slot> slots,
    Map<CombatantId, String> assignment,
    long dealtTick) {

  public static final TeamPlan NONE =
      new TeamPlan(
          Optional.empty(),
          Optional.empty(),
          Optional.empty(),
          List.of(),
          0,
          List.of(),
          Map.of(),
          -1);

  public TeamPlan {
    lanes = List.copyOf(lanes);
    if (!(push >= 0 && push <= 1)) {
      throw new IllegalArgumentException("push must be 0..1: " + push);
    }
    slots = List.copyOf(slots);
    assignment = Map.copyOf(assignment);
    var keys = new HashSet<String>();
    for (var slot : slots) {
      if (!keys.add(slot.key())) {
        throw new IllegalArgumentException("duplicate slot key " + slot.key());
      }
      if (slot.lane() >= lanes.size()) {
        throw new IllegalArgumentException(slot.key() + " names a lane the plan does not have");
      }
    }
    if (!keys.containsAll(assignment.values())) {
      throw new IllegalArgumentException("a bot holds a slot the plan does not have");
    }
  }

  /** The slot {@code bot} holds. */
  public Optional<Slot> slotOf(CombatantId bot) {
    var key = assignment.get(bot);
    return key == null ? Optional.empty() : slot(key);
  }

  public Optional<Slot> slot(String key) {
    return slots.stream().filter(slot -> slot.key().equals(key)).findFirst();
  }

  /** Who holds the slot named {@code key}. */
  public Optional<CombatantId> holderOf(String key) {
    return assignment.entrySet().stream()
        .filter(entry -> entry.getValue().equals(key))
        .map(Map.Entry::getKey)
        .sorted()
        .findFirst();
  }

  /** The other bots whose slots share {@code bot}'s pair, in id order. */
  public List<CombatantId> partners(CombatantId bot) {
    var mine = slotOf(bot).filter(Slot::paired);
    if (mine.isEmpty()) {
      return List.of();
    }
    var pair = mine.orElseThrow().pair();
    return assignment.keySet().stream()
        .filter(other -> !other.equals(bot))
        .filter(other -> slotOf(other).map(slot -> slot.pair() == pair).orElse(false))
        .sorted()
        .toList();
  }

  /** The lane a slot routes along. */
  public Optional<Lane> laneOf(Slot slot) {
    return slot.lane() < 0 ? Optional.empty() : Optional.of(lanes.get(slot.lane()));
  }
}
