package com.shepherdjerred.thestorm.rwfbots.sim;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** A bomb's guards meet an attacker on its way in, not once it is already at the bomb. */
final class GuardReactionTest {

  /** Closer than this to the bomb, an attacker is already on it. */
  private static final double AT_THE_BOMB = 12;

  private record Tally(int reacted, int early) {}

  @Test
  void guardsFirstAnswerAnAttackerWhileItIsStillOnItsWayToTheBomb() {
    var reacted = 0;
    var early = 0;
    for (var seed = 1L; seed <= 8; seed++) {
      var tally = play(Arenas.yard(seed, 8, Strategy.TURTLE, Strategy.RUSH));
      reacted += tally.reacted();
      early += tally.early();
    }
    assertThat(reacted).isGreaterThanOrEqualTo(8);
    // Guards that only answered an enemy within 12 blocks of the bomb did so early in 36 of 65
    // first answers on these seeds; answering one on its way in raised that to 42 of 52.
    assertThat((double) early / reacted)
        .as("%d of %d guards first answered an attacker 12+ blocks from the bomb", early, reacted)
        .isGreaterThanOrEqualTo(0.7);
  }

  /** Each guard's first fight or retake, and whether the attacker was still 12+ blocks out. */
  private static Tally play(SimWorld world) {
    var first = new HashMap<CombatantId, Double>();
    world.run(
        1200,
        w -> {
          observe(w, first);
          return false;
        });
    var early = (int) first.values().stream().filter(range -> range >= AT_THE_BOMB).count();
    return new Tally(first.size(), early);
  }

  private static void observe(SimWorld world, Map<CombatantId, Double> first) {
    for (var body : world.bodies.values()) {
      if (!body.alive || !body.bot || first.containsKey(body.id) || !guard(world, body)) continue;
      var answering =
          body.decision
              .map(
                  decision ->
                      decision.option() == Option.RETAKE || decision.option() == Option.ENGAGE)
              .orElse(false);
      if (answering) first.put(body.id, attackerRange(world, body));
    }
  }

  private static boolean guard(SimWorld world, SimBody body) {
    var board = world.boards.get(body.team);
    if (board == null) return false;
    var role = board.roleOf(body.id);
    return role.filter(r -> r == Role.DEFEND || r == Role.RETAKE).isPresent()
        || board.slotOf(body.id).filter(slot -> slot.kind() == SlotKind.ANCHOR).isPresent();
  }

  /** How far the nearest living enemy stands from the guard's own bomb. */
  private static double attackerRange(SimWorld world, SimBody guard) {
    var best = Double.POSITIVE_INFINITY;
    for (var bomb : world.bombs.values()) {
      if (!(bomb.owner instanceof BombOwner.Team(var team)) || !team.equals(guard.team)) continue;
      for (var enemy : world.bodies.values()) {
        if (enemy.alive && !enemy.team.equals(guard.team)) {
          best = Math.min(best, enemy.pos.distance(bomb.pos));
        }
      }
    }
    return best;
  }
}
