package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwf.app.BattleSoundLog;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.IdMap;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.SnapshotCapture;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.StimulusCollector;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Suspicion;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Plan;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.PlanStep;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Planner;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Situation;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsContext;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/** Native acceptance driver using the production planner, health search, reflex and baked codec. */
final class TraversalRoute {
  private static final TeamId TEAM = new TeamId("red");
  private static final InstantSource TIME = InstantSource.fixed(Instant.EPOCH);
  private final TacticsContext context;
  private final Vec3 goal;
  private final Stance stance;
  private final SplittableRandom random = new SplittableRandom(196);
  // This modules-disabled fixture has no match-owned power immunity. Bukkit attributes, gear,
  // effects and accumulated fall distance are still captured by the production adapter.
  private final SnapshotCapture capture =
      new SnapshotCapture(
          new IdMap(),
          id -> Optional.empty(),
          new StimulusCollector(new BattleSoundLog(TIME), TIME),
          new SnapshotCapture.Capabilities(id -> Optional.empty(), TIME));
  private Optional<TraversalState> capturedTraversal = Optional.empty();
  private ReflexState reflex = ReflexState.initial(new Facing(-90, 0));
  private Optional<Decision> decision = Optional.empty();
  private Optional<Vec3> previous = Optional.empty();

  TraversalRoute(BlockClassification blocks, Location destination, boolean sprint) {
    var baked = MapBaker.bake("traversal-native", blocks, new NavSites(List.of(), List.of()));
    var decoded =
        com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec.decode(
            com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec.encode(baked));
    var nav =
        switch (decoded) {
          case com.shepherdjerred.thestorm.core.result.Result.Ok(var value) -> value;
          case com.shepherdjerred.thestorm.core.result.Result.Err(var error) ->
              throw new IllegalStateException("native traversal codec failed: " + error);
        };
    context =
        new TacticsContext(
            nav,
            LeverCurves.at(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.DUELIST,
            Set.of(),
            196,
            nav.graph().workspace());
    goal = new Vec3(destination.getX(), destination.getY(), destination.getZ());
    stance = sprint ? Stance.AGGRESSIVE : Stance.CAUTIOUS;
  }

  List<BodyCommand> tick(Player player, long tick) {
    var self = self(player, tick);
    capturedTraversal = Optional.of(self.traversal());
    previous = Optional.of(self.pos());
    var snapshot =
        new WorldSnapshot(
            tick,
            MatchPhase.LIVE,
            List.of(self),
            List.of(),
            PoisonView.NONE,
            context.nav().mapId(),
            List.of());
    var percept = new Percept(new PerceptionState(Memory.EMPTY, Suspicion.NONE), List.of(), tick);
    var situation =
        new Situation(self, snapshot, percept, Blackboard.open(TEAM, Strategy.HUNT), Role.HUNT);
    if (decision.isEmpty() || tick % 5 == 0)
      decision =
          Optional.of(
              Planner.decide(
                  Plan.of(Option.HUNT, tick, new PlanStep.Route(goal, stance)),
                  situation,
                  context,
                  0));
    var step =
        Reflex.tick(
            reflex,
            ReflexInput.of(self, snapshot, decision.orElseThrow(), percept),
            new ReflexContext(
                context.nav().grid(), context.levers(), Loadout.standard(Kit.TROOPER)),
            random);
    reflex = step.state();
    return step.commands();
  }

  Optional<TraversalState> capturedTraversal() {
    return capturedTraversal;
  }

  Optional<com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch> runUp() {
    return reflex
        .activeJump()
        .filter(
            active ->
                active.stage()
                    == com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump.Stage.RUN_UP)
        .flatMap(active -> active.waypoint().launch());
  }

  com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds bounds() {
    return context.nav().grid().bounds();
  }

  private CombatantView self(Player player, long tick) {
    var at = player.getLocation();
    var point = new Vec3(at.getX(), at.getY(), at.getZ());
    return new CombatantView(
        new CombatantId(1),
        TEAM,
        false,
        Kit.TROOPER,
        !player.isDead(),
        point,
        previous.map(point::minus).orElse(Vec3.ZERO),
        at.getYaw(),
        at.getPitch(),
        player.getHealth(),
        player.getAbsorptionAmount(),
        0,
        player.getInventory().getHeldItemSlot(),
        player.isSprinting(),
        SnapshotCapture.onGround(player),
        player.isHandRaised(),
        false,
        -1,
        capture.captureTraversal(player, "trooper", tick));
  }
}
