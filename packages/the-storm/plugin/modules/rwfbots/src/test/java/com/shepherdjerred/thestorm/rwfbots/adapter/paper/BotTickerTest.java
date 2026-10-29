package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.app.Director;
import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.BitSet;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class BotTickerTest {
  @Test
  void typingYieldsToCommittedAirborneControlButPausesGroundedApproach() {
    var bot = bot();
    var input = idle(combatant(1, RED, new Vec3(1.5, 1, 1.5)));
    var landing =
        new Waypoint(
            new Vec3(4.5, 1, 1.5),
            Hop.LEAP,
            Optional.of(new JumpLaunch(input.self().pos(), new Vec3(0.5, 1, 1.5), 0.27, 13)));
    var approach =
        new ActiveJump(
            landing,
            new ActiveJump.Intent(Option.HUNT, landing.pos()),
            ActiveJump.Stage.RUN_UP,
            1,
            -1);
    bot.reflex(bot.reflex().withActiveJump(Optional.of(approach)));
    var activity = new TypingActivity();
    assertThat(BotTicker.communicationPaused(bot, input, activity)).isTrue();
    assertThat(activity.busy).isTrue();
    bot.reflex(
        bot.reflex().withActiveJump(Optional.of(approach.stage(ActiveJump.Stage.AIRBORNE, 2))));
    assertThat(BotTicker.communicationPaused(bot, input, activity)).isFalse();
    assertThat(activity.busy).isFalse();
    assertThat(bot.reflex().activeJump()).contains(approach.stage(ActiveJump.Stage.AIRBORNE, 2));
  }

  @Test
  void actualFallDistanceCancelsTypingWithoutAnAuthoredJump() {
    var self = combatant(1, RED, new Vec3(1.5, 3, 1.5));
    var activity = new TypingActivity();
    var bot = bot();
    assertThat(BotTicker.communicationPaused(bot, idle(self), activity)).isTrue();
    assertThat(
            BotTicker.communicationPaused(
                bot, idle(self.withTraversal(self.traversal().withFallDistance(0.25))), activity))
        .isFalse();
    assertThat(activity.busy).isFalse();
  }

  @Test
  void aJumpOrFallHoldsTheLineForTheLandingAndOnlyFuseWorkDropsIt() {
    var self = combatant(1, RED, new Vec3(1.5, 3, 1.5));
    var activity = new HoldingActivity();
    var bot = bot();
    assertThat(
            BotTicker.communicationPaused(
                bot, idle(self.withTraversal(self.traversal().withFallDistance(0.25))), activity))
        .isFalse();
    assertThat(activity.deferred).isEqualTo(1);
    assertThat(activity.cancelled).isZero();
  }

  /** Records how speech was told to yield; deferring holds the line without typing. */
  private static final class HoldingActivity implements BodyActivity {
    private int deferred;
    private int cancelled;
    private boolean held;

    @Override
    public boolean typing(UUID uuid) {
      return !held;
    }

    @Override
    public void cancel(UUID uuid) {
      cancelled++;
      held = true;
    }

    @Override
    public void defer(UUID uuid) {
      deferred++;
      held = true;
    }
  }

  private static BotBody bot() {
    return new BotBody(
        new UUID(0, 1),
        new Director.Drafted(
            Fixtures.personality("ash", "Ash_42", 0.5),
            Kit.TROOPER,
            LeverCurves.at(0.5),
            Rating.DEFAULT));
  }

  private static ReflexInput idle(CombatantView self) {
    var snapshot =
        new WorldSnapshot(
            20,
            MatchPhase.LIVE,
            List.of(self),
            List.of(),
            PoisonView.NONE,
            "test",
            List.of(),
            List.of(),
            List.of());
    return new ReflexInput(
        self, snapshot, Decision.idle(self.id(), 20, 0), Optional.empty(), 0, List.of());
  }

  private static final class TypingActivity implements BodyActivity {
    private boolean busy = true;

    @Override
    public boolean typing(UUID uuid) {
      return busy;
    }

    @Override
    public void cancel(UUID uuid) {
      busy = false;
    }
  }

  @Test
  void anEnemyThatMovesBehindCoverCannotBeRefreshedFromTheGlobalSnapshot() {
    var self = combatant(1, RED, new Vec3(1.5, 1, 1.5));
    var oldEnemy = combatant(2, BLUE, new Vec3(1.5, 1, 2.5));
    var enemy = combatant(2, BLUE, new Vec3(1.5, 1, 6.5));
    var snapshot =
        new WorldSnapshot(
            20,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(),
            PoisonView.NONE,
            "test",
            List.of(),
            List.of(),
            List.of());
    var input =
        new ReflexInput(
            self, snapshot, Decision.idle(self.id(), 19, 0), Optional.of(oldEnemy), 0, List.of());
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 10, 5, 10);
    var empty = new BitSet();
    assertThat(BotTicker.freshTarget(input, new VoxelGrid(bounds, empty, empty, empty)).target())
        .contains(enemy);
    var wall = new BitSet();
    for (var y = 0; y < 5; y++) wall.set(bounds.index(1, y, 4));
    assertThat(BotTicker.freshTarget(input, new VoxelGrid(bounds, empty, wall, empty)).target())
        .isEmpty();
  }

  @Test
  void aReadyBowIsLoweredForAnotherPerceivedEnemyWhenTheNearestOneDucksBehindCover() {
    // Review finding: the input kept only the nearest perceived enemy, so once freshTarget found
    // that one behind cover nothing was left to lower the bow for another perceived enemy already
    // inside MELEE_ALERT.
    var nav = SyntheticMap.bake();
    var archerAt = new Vec3(5.5, 1, 5.5);
    var self = combatant(1, RED, archerAt);
    var far = combatant(2, BLUE, archerAt.plus(20, 0, 0));
    var ducked = combatant(3, BLUE, archerAt.plus(0, 0, 2));
    var near = combatant(4, BLUE, archerAt.plus(Reflex.MELEE_ALERT - 1, 0, 0));
    var world = List.of(self, far, ducked, near);
    var decision =
        new Decision(
            self.id(),
            Option.ENGAGE,
            Optional.of(far.id()),
            List.of(),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "engage:fight-peek",
            1,
            0,
            Optional.empty());
    var bounds = nav.grid().bounds();
    var sight = (BitSet) nav.grid().sight().clone();
    for (var y = bounds.origin().y(); y < bounds.origin().y() + bounds.sizeY(); y++) {
      sight.set(bounds.index(5, y, 6));
    }
    var grid = new VoxelGrid(bounds, nav.grid().movement(), sight, nav.grid().projectile());
    var archer = new ReflexContext(grid, Fixtures.levers(1), Loadout.standard(Kit.LONGBOW));
    var state = ReflexState.initial(Facing.SOUTH);
    for (var tick = 1; tick <= 5; tick++) {
      var snapshot = snapshot(tick, world);
      var aiming =
          ReflexInput.of(
              self, snapshot, decision, new Percept(PerceptionState.EMPTY, List.of(far), tick));
      state = Reflex.tick(state, aiming, archer, new SplittableRandom(tick)).state();
    }
    assertThat(state.isDrawing()).isTrue();
    var both = new Percept(PerceptionState.EMPTY, List.of(ducked, near), 6);
    var pressed =
        BotTicker.freshTarget(ReflexInput.of(self, snapshot(6, world), decision, both), grid);
    assertThat(pressed.target()).isEmpty();
    assertThat(pressed.perceived()).containsExactly(near);
    assertThat(Reflex.tick(state, pressed, archer, new SplittableRandom(6)).commands())
        .contains(new BodyCommand.CancelUse());
    var alone = new Percept(PerceptionState.EMPTY, List.of(ducked), 6);
    var hidden =
        BotTicker.freshTarget(ReflexInput.of(self, snapshot(6, world), decision, alone), grid);
    assertThat(hidden.perceived()).isEmpty();
    assertThat(Reflex.tick(state, hidden, archer, new SplittableRandom(6)).commands())
        .doesNotContain(new BodyCommand.CancelUse());
  }

  private static WorldSnapshot snapshot(long tick, List<CombatantView> world) {
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        world,
        List.of(),
        PoisonView.NONE,
        "synthetic",
        List.of(),
        List.of(),
        List.of());
  }
}
