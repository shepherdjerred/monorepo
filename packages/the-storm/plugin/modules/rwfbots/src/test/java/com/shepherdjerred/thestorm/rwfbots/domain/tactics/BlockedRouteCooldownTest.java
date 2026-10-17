package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class BlockedRouteCooldownTest {
  private static final Vec3 START = new Vec3(5.5, 1, 5.5);
  private static final Vec3 GOAL = START.plus(1000, 0, 0);
  private static final TacticsContext CONTEXT =
      new TacticsContext(
          SyntheticMap.bake(),
          levers(1),
          new Style(0.5, 0.5, 0.5, 0.5),
          Kit.TROOPER,
          Archetype.TACTICIAN,
          Set.of(),
          42,
          null);

  private static Situation situation(long tick, List<BombView> bombs) {
    var self = combatant(1, RED, START);
    var slot =
        new Slot(
            "blocked-slot", SlotKind.FLANK, Role.ROTATE, GOAL, GOAL, -1, -1, Optional.empty(), 0);
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .withPlan(
                new TeamPlan(
                    Optional.of(Strategy.RUSH),
                    Optional.of(START),
                    Optional.empty(),
                    List.of(),
                    0.5,
                    List.of(slot),
                    Map.of(self.id(), slot.key()),
                    0,
                    Map.of()),
                0);
    var snapshot =
        new WorldSnapshot(
            tick,
            MatchPhase.LIVE,
            List.of(self, combatant(2, BLUE, START.plus(20, 0, 0))),
            bombs,
            PoisonView.NONE,
            CONTEXT.nav().mapId(),
            List.of());
    return new Situation(
        self, snapshot, new Percept(PerceptionState.EMPTY, List.of(), tick), board, Role.ROTATE);
  }

  private static TacticsState state(long tick, TacticalMemory memory) {
    var plan =
        Plan.of(Option.TAKE_SLOT, tick - 5, new PlanStep.Route(GOAL, Stance.AGGRESSIVE, true));
    return new TacticsState(Optional.of(plan), tick - 5, 1, 0, RewindClock.UNSTARTED, memory);
  }

  private static Thought think(long tick, TacticalMemory memory) {
    return Tactics.think(
        state(tick, memory), situation(tick, List.of()), CONTEXT, new SplittableRandom(1));
  }

  @Test
  void rememberedUnreachableSlotsRecoverWithoutExtendingTheRetryDeadline() {
    var memory = TacticalMemory.EMPTY.blocked(GOAL, 50);
    for (var tick : List.of(100L, 125L)) {
      var thought = think(tick, memory);
      assertThat(thought.decision().option()).isEqualTo(Option.HUNT);
      assertThat(thought.state().memory().blockedUntil()).containsEntry(GOAL, 150L);
      memory = thought.state().memory();
    }
  }

  @Test
  void anUnreachableSlotIsRetriedAtTheExactDeadline() {
    var memory = TacticalMemory.EMPTY.blocked(GOAL, 50);
    assertThat(memory.excludes(GOAL, 150)).isFalse();
    var thought = think(150, memory);
    assertThat(thought.state().memory().blockedUntil()).containsEntry(GOAL, 250L);
    assertThat(thought.decision().option()).isEqualTo(Option.HUNT);
  }

  @Test
  void aForcedDefuseBypassesTheExcludedFormationSlot() {
    var bomb =
        new BombView(
            new BombId(0),
            new BombOwner.Team(RED),
            CONTEXT.nav().sites().bombs().getFirst().cell().center(),
            new BombState.Armed(900));
    var memory =
        TacticalMemory.EMPTY
            .blocked(GOAL, 50)
            .objective(Optional.of(bomb.id()), Optional.empty(), 0);
    var situation = situation(100, List.of(bomb));
    assertThat(ObjectivePolicy.direct(memory, situation, CONTEXT).forced()).contains(Option.DEFUSE);
    var thought = Tactics.think(state(100, memory), situation, CONTEXT, new SplittableRandom(1));
    assertThat(thought.decision().option()).isEqualTo(Option.DEFUSE);
    assertThat(thought.state().memory().defusing()).contains(bomb.id());
    assertThat(thought.state().memory().blockedUntil()).containsEntry(GOAL, 150L);
  }

  @Test
  void aNewLifeDropsThePreviousLivesBlockedDestinations() {
    var next = state(100, TacticalMemory.EMPTY.blocked(GOAL, 50)).nextLife(2);
    assertThat(next.lifeEpoch()).isEqualTo(2);
    assertThat(next.memory().blockedUntil()).isEmpty();
    assertThat(next.plan()).isEmpty();
  }
}
