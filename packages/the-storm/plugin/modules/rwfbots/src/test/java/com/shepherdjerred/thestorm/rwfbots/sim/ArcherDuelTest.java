package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.BowSolver;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/**
 * A swordsman charging an archer 20 to 30 blocks off across open ground. The archer looses each
 * full draw with a bot's aim error, led on the swordsman's velocity as bot archers lead or aimed
 * where it stands. A swordsman that sees the draw weaves across the line and takes fewer arrows.
 */
final class ArcherDuelTest {

  /** A flat 48-block stone field. */
  private static final class Field implements BlockClassification {
    private final GridBounds bounds = new GridBounds(new BlockPos(0, 0, 0), 48, 6, 48);

    @Override
    public GridBounds bounds() {
      return bounds;
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      return y == 0 ? BlockShape.FULL : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return y == 0;
    }
  }

  private static final NavArtifact FIELD =
      MapBaker.bake("field", new Field(), new NavSites(List.of(), List.of()));

  private static final Vec3 ARCHER = new Vec3(24.5, 1, 44.5);
  private static final int LIMIT = 400;
  private static final long SEEDS = 40;

  /**
   * One charge.
   *
   * @param shots arrows loosed before the swordsman reached sword range
   * @param hits arrows that struck it
   * @param ticks how long it took to reach sword range
   */
  record Charge(int shots, int hits, long ticks) {}

  /** Every charge of one side of the comparison. */
  record Tally(List<Charge> charges) {
    double hitRate() {
      return (double) charges.stream().mapToInt(Charge::hits).sum()
          / charges.stream().mapToInt(Charge::shots).sum();
    }

    double hitsPerCharge() {
      return charges.stream().mapToInt(Charge::hits).average().orElseThrow();
    }

    double ticks() {
      return charges.stream().mapToLong(Charge::ticks).average().orElseThrow();
    }

    @Override
    public String toString() {
      return String.format(
          "%.1f%% of arrows, %.2f per charge, %.1f ticks",
          100 * hitRate(), hitsPerCharge(), ticks());
    }
  }

  @Test
  void aSwordsmanWeavesUnderADrawnBowAndTakesFewerArrowsFromALeadingArcher() {
    var straight = tally(false, true);
    var weaving = tally(true, true);

    assertThat(weaving.charges()).allMatch(charge -> charge.ticks() < LIMIT);
    assertThat(weaving.hitsPerCharge())
        .as("weaving %s against straight %s", weaving, straight)
        .isLessThan(0.75 * straight.hitsPerCharge());
    assertThat(weaving.ticks()).isLessThan(1.25 * straight.ticks());
  }

  @Test
  void weavingAlsoBeatsAnArcherThatAimsWhereItsTargetStands() {
    var straight = tally(false, false);
    var weaving = tally(true, false);

    assertThat(weaving.hitsPerCharge())
        .as("weaving %s against straight %s", weaving, straight)
        .isLessThan(straight.hitsPerCharge());
  }

  /** Charges from 20, 25 and 30 blocks; {@code drawing} shows the archer's draw to the bot. */
  private static Tally tally(boolean drawing, boolean leads) {
    var charges = new ArrayList<Charge>();
    for (var distance : List.of(20, 25, 30)) {
      for (var seed = 1L; seed <= SEEDS; seed++) {
        charges.add(new Duel(distance, seed, drawing).charge(leads));
      }
    }
    return new Tally(charges);
  }

  /** One swordsman, driven by the reflex alone, and one archer that only shoots. */
  private static final class Duel {
    private final SplittableRandom random;
    private final SimPhysics physics = new SimPhysics(FIELD);
    private final SimBody swordsman;
    private final SimBody archer;
    private final ReflexContext context =
        new ReflexContext(
            FIELD, levers(0.65), Loadout.standard(Kit.TROOPER), ReflexContext.Habits.NONE);
    private final List<Vec3[]> arrows = new ArrayList<>();
    private ReflexState state;

    Duel(int distance, long seed, boolean drawing) {
      random = new SplittableRandom(seed);
      var start = ARCHER.plus(0, 0, -distance);
      swordsman = new SimBody(new SimWorld.Spawn(1, RED, Kit.TROOPER, start));
      swordsman.look = Facing.looking(start, ARCHER);
      archer = new SimBody(new SimWorld.Spawn(2, BLUE, Kit.LONGBOW, ARCHER));
      archer.usingItem = true;
      archer.drawingBow = drawing;
      state = ReflexState.initial(swordsman.look);
    }

    Charge charge(boolean leads) {
      var ranged = Loadout.standard(Kit.LONGBOW).ranged();
      var shots = 0;
      var hits = 0;
      var drawn = 0L;
      for (var tick = 1L; tick <= LIMIT; tick++) {
        var self = swordsman.view(tick);
        var bow = archer.view(tick);
        if (self.pos().horizontalDistance(bow.pos()) <= Reflex.REACH)
          return new Charge(shots, hits, tick);
        var heard = new ArrayList<Stimulus>();
        if (tick - drawn >= ranged.chargeTicks() && loose(self, bow, leads)) {
          shots++;
          drawn = tick;
          heard.add(Stimulus.by(Stimulus.Kind.BOW_SHOT, bow.pos(), tick, bow.id()));
        }
        step(self, bow, heard, tick);
        if (struck(tick)) hits++;
      }
      return new Charge(shots, hits, LIMIT);
    }

    /** Looses a full draw at the swordsman, led on its velocity or at where it stands. */
    private boolean loose(CombatantView self, CombatantView bow, boolean leads) {
      var speed = Loadout.standard(Kit.LONGBOW).ranged().projectileSpeed();
      var flight = BowSolver.flightTicks(bow.pos().horizontalDistance(self.pos()), speed);
      var point = leads ? BowSolver.lead(FIELD.grid(), self, flight) : self.pos().plus(0, 1.3, 0);
      var aim = BowSolver.facing(bow.eye(), point, speed);
      if (aim.isEmpty()) return false;
      var error = levers(0.65).aimErrorDeg();
      var facing = aim.orElseThrow();
      var loosed =
          new Facing(
              facing.yaw() + random.nextGaussian() * error,
              facing.pitch() + random.nextGaussian() * error);
      arrows.add(new Vec3[] {bow.eye(), loosed.direction().scale(speed)});
      return true;
    }

    private void step(CombatantView self, CombatantView bow, List<Stimulus> heard, long tick) {
      var world =
          new WorldSnapshot(
              tick,
              MatchPhase.LIVE,
              List.of(self, bow),
              List.of(),
              PoisonView.NONE,
              FIELD.mapId(),
              heard,
              List.of(),
              List.of());
      var decision =
          new Decision(
              new CombatantId(1),
              Option.ENGAGE,
              Optional.of(bow.id()),
              List.of(),
              Stance.AGGRESSIVE,
              Optional.empty(),
              Optional.of(bow.pos()),
              Optional.empty(),
              "engage:fight",
              tick,
              1,
              Optional.empty());
      var step =
          Reflex.tick(
              state,
              new ReflexInput(
                  self, world, decision, Optional.of(bow), 0, List.of(bow), Optional.empty()),
              context,
              random);
      state = step.state();
      swordsman.previousPos = swordsman.pos;
      for (var command : step.commands()) {
        switch (command) {
          case BodyCommand.MoveToward(var at, var sprint, var _) -> {
            swordsman.sprinting = sprint;
            physics.steer(swordsman, at.minus(swordsman.pos));
          }
          case BodyCommand.Stop _ -> {
            swordsman.sprinting = false;
            physics.steer(swordsman, Vec3.ZERO);
          }
          case BodyCommand.Jump(var hop) -> {
            if (hop) physics.hop(swordsman, tick);
            else physics.jump(swordsman, tick);
          }
          case BodyCommand.Look(var yaw, var pitch) -> swordsman.look = new Facing(yaw, pitch);
          default -> {}
        }
      }
      physics.move(swordsman, tick);
    }

    /** Flies every arrow a tick with the bow solver's drag and gravity; whether one struck. */
    private boolean struck(long tick) {
      var body = swordsman.view(tick).box();
      var struck = false;
      for (var it = arrows.iterator(); it.hasNext(); ) {
        var arrow = it.next();
        var velocity = arrow[1];
        var entry = body.rayEntry(arrow[0], velocity.normalized());
        if (entry.isPresent() && entry.getAsDouble() <= velocity.length()) {
          swordsman.hurt(0, tick);
          it.remove();
          struck = true;
          continue;
        }
        arrow[0] = arrow[0].plus(velocity);
        arrow[1] = velocity.scale(BowSolver.DRAG).plus(0, -BowSolver.GRAVITY, 0);
        if (arrow[0].y() < 0) it.remove();
      }
      return struck;
    }
  }
}
