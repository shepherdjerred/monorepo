package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.app.Loadouts;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/** When bots use their kit items, and the hotbar slots they reach for. */
final class KitPlayTest {

  private static final NavArtifact NAV = SyntheticMap.bake();
  private static final Vec3 HERE = new Vec3(5.5, 1, 5.5);

  @Test
  void ghostAndWraithTravelEmptyHandedThenEquipForCombat() {
    for (var kit : List.of(Kit.GHOST, Kit.WRAITH)) {
      var self = with(combatant(1, RED, HERE), kit, 20);
      var idle = input(self, Optional.empty(), List.of());
      var context = new ReflexContext(NAV.grid(), levers(0.8), Loadouts.rwf(kit));
      var state = ReflexState.initial(com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing.SOUTH);
      var waiting = Reflex.tick(state, idle, context, new SplittableRandom(4));
      assertThat(waiting.commands()).contains(new BodyCommand.SelectSlot(8));
      var enemy = combatant(2, BLUE, HERE.plus(2, 0, 0));
      var fight = input(self.withHands(8, false), Optional.of(enemy), List.of());
      var attack = Reflex.tick(waiting.state(), fight, context, new SplittableRandom(4));
      assertThat(attack.commands())
          .contains(new BodyCommand.SelectSlot(context.loadout().swordSlot()));
      assertThat(attack.commands()).doesNotContain(new BodyCommand.SelectSlot(8));
      if (kit == Kit.GHOST) {
        var distant =
            input(
                self.withHands(8, false),
                Optional.of(enemy.withPos(HERE.plus(12, 0, 0))),
                List.of());
        var pursuit = Reflex.tick(waiting.state(), distant, context, new SplittableRandom(4));
        assertThat(pursuit.commands())
            .doesNotContain(new BodyCommand.SelectSlot(context.loadout().swordSlot()));
      }
    }
  }

  @Test
  void aWindJumpNeedsBroadSupportedGroundAndAnActualClimb() {
    var self = with(combatant(1, RED, HERE), Kit.WINDRUNNER, 20);
    var item = Loadouts.rwf(Kit.WINDRUNNER).kitItems().getFirst();
    var base = input(self, Optional.empty(), List.of());
    var climb =
        new ReflexInput(
            self,
            base.snapshot(),
            decision(self, List.of(new Waypoint(HERE.plus(3, 2, 0), Hop.JUMP))),
            Optional.empty(),
            0,
            Optional.empty());
    assertThat(KitPlay.choose(item, climb, 0, Optional.of(NAV.grid())))
        .get()
        .extracting(BodyCommand.UseKit::at)
        .isEqualTo(Optional.of(HERE.plus(0, -0.1, 0)));
    assertThat(KitPlay.choose(item, base, 0, Optional.of(NAV.grid()))).isEmpty();
    assertThat(KitPlay.safeLaunch(NAV.grid(), new Vec3(0.5, 1, 0.5))).isFalse();
    var unsupported =
        new com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid(
            NAV.grid().bounds(),
            new java.util.BitSet(),
            new java.util.BitSet(),
            new java.util.BitSet());
    assertThat(KitPlay.choose(item, climb, 0, Optional.of(unsupported))).isEmpty();
  }

  private static CombatantView with(CombatantView view, Kit kit, double health) {
    return new CombatantView(
        view.id(),
        view.team(),
        false,
        kit,
        true,
        view.pos(),
        Vec3.ZERO,
        0,
        0,
        health,
        0,
        15,
        1,
        false,
        true,
        false,
        false,
        -1,
        view.traversal(),
        view.quiver());
  }

  private static Decision decision(CombatantView self, List<Waypoint> waypoints) {
    return new Decision(
        self.id(),
        Option.TAKE_SLOT,
        Optional.empty(),
        waypoints,
        Stance.AGGRESSIVE,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        "kit test",
        1,
        0,
        java.util.Optional.empty());
  }

  private static ReflexInput input(
      CombatantView self, Optional<CombatantView> target, List<CombatantView> others) {
    var views = new ArrayList<CombatantView>();
    views.add(self);
    views.addAll(others);
    target.ifPresent(views::add);
    var world =
        new WorldSnapshot(
            1,
            MatchPhase.LIVE,
            views,
            List.of(),
            PoisonView.NONE,
            "synthetic",
            List.of(),
            List.of());
    return new ReflexInput(self, world, decision(self, List.of()), target, 0, Optional.empty());
  }

  private static Optional<BodyCommand.UseKit> first(Kit kit, ReflexInput input, int waypoint) {
    for (var item : Loadouts.rwf(kit).kitItems()) {
      var use = KitPlay.choose(item, input, waypoint);
      if (use.isPresent()) {
        return use;
      }
    }
    return Optional.empty();
  }

  @ParameterizedTest
  @EnumSource(Kit.class)
  void everyKitsItemsAreOnItsHotbar(Kit kit) {
    var loadout = Loadouts.rwf(kit);

    assertThat(loadout.fuseSlot()).isZero();
    assertThat(loadout.kitItems()).hasSameSizeAs(kit.moves());
    assertThat(loadout.hasBow()).isEqualTo(kit.hasBow());
  }

  @Test
  void theHotbarIsReadFromTheKitList() {
    assertThat(Loadouts.rwf(Kit.TROOPER))
        .isEqualTo(new Loadout(1, -1, 2, 0, List.of(), Kit.Body.PLAIN, Weapon.LEGACY, Weapon.NONE));
    var medic = Loadouts.rwf(Kit.MEDIC);
    assertThat(medic.gappleSlot()).isEqualTo(3);
    assertThat(medic.kitItems()).extracting(Loadout.KitItem::slot).containsExactly(2);
    assertThat(Loadouts.rwf(Kit.TRACKER).bowSlot()).isEqualTo(2);
  }

  @Test
  void aMedicWavesItsWandWhenAnAllyNearbyIsHurt() {
    var self = with(combatant(1, RED, HERE), Kit.MEDIC, 20);
    var ally = with(combatant(2, RED, HERE.plus(3, 0, 0)), Kit.TROOPER, 8);
    var far = with(combatant(3, RED, HERE.plus(20, 0, 0)), Kit.TROOPER, 8);

    assertThat(first(Kit.MEDIC, input(self, Optional.empty(), List.of(ally)), 0))
        .contains(new BodyCommand.UseKit(2, Optional.empty(), Optional.empty()));
    assertThat(first(Kit.MEDIC, input(self, Optional.empty(), List.of(far)), 0)).isEmpty();
  }

  @Test
  void anExplosiveFiresAnRpgAtRangeAndAGrenadeUpClose() {
    var self = with(combatant(1, RED, HERE), Kit.EXPLOSIVE, 20);
    var distant = with(combatant(2, BLUE, HERE.plus(20, 0, 0)), Kit.TROOPER, 20);
    var close = with(combatant(3, BLUE, HERE.plus(5, 0, 0)), Kit.TROOPER, 20);

    var rpg = first(Kit.EXPLOSIVE, input(self, Optional.of(distant), List.of()), 0).orElseThrow();
    var grenade = first(Kit.EXPLOSIVE, input(self, Optional.of(close), List.of()), 0).orElseThrow();

    assertThat(rpg.slot()).isEqualTo(2);
    assertThat(rpg.at()).contains(distant.pos().plus(0, KitPlay.CHEST, 0));
    assertThat(grenade.slot()).isEqualTo(3);
  }

  @Test
  void aWarperUsesItsWandOnAnEnemyInReach() {
    var self = with(combatant(1, RED, HERE), Kit.WARPER, 20);
    var enemy = with(combatant(2, BLUE, HERE.plus(2, 0, 0)), Kit.TROOPER, 20);

    assertThat(first(Kit.WARPER, input(self, Optional.of(enemy), List.of()), 0))
        .contains(new BodyCommand.UseKit(2, Optional.of(enemy.id()), Optional.empty()));
  }

  @Test
  void placingWaitsUntilTheBotHasArrivedWithNobodyInSight() {
    var self = with(combatant(1, RED, HERE), Kit.DEMOLITIONS, 20);
    var enemy = with(combatant(2, BLUE, HERE.plus(10, 0, 0)), Kit.TROOPER, 20);
    var walking =
        new ReflexInput(
            self,
            input(self, Optional.empty(), List.of()).snapshot(),
            decision(self, List.of(new Waypoint(HERE.plus(9, 0, 0), Hop.WALK))),
            Optional.empty(),
            0,
            Optional.empty());

    assertThat(first(Kit.DEMOLITIONS, input(self, Optional.empty(), List.of()), 0)).isPresent();
    assertThat(first(Kit.DEMOLITIONS, input(self, Optional.of(enemy), List.of()), 0)).isEmpty();
    assertThat(first(Kit.DEMOLITIONS, walking, 0)).isEmpty();
  }

  @Test
  void engineersAndDecoysOnlyReachForTheirItemWhenHurt() {
    var healthy = with(combatant(1, RED, HERE), Kit.ENGINEER, 20);
    var hurt = with(combatant(1, RED, HERE), Kit.ENGINEER, 6);
    var enemy = with(combatant(2, BLUE, HERE.plus(4, 0, 0)), Kit.TROOPER, 20);

    assertThat(first(Kit.ENGINEER, input(healthy, Optional.of(enemy), List.of()), 0)).isEmpty();
    assertThat(first(Kit.ENGINEER, input(hurt, Optional.of(enemy), List.of()), 0)).isPresent();
  }

  @Test
  void aGrapplerHooksTowardAFarWaypoint() {
    var self = with(combatant(1, RED, HERE), Kit.GRAPPLER, 20);
    var far = HERE.plus(20, 0, 0);
    var input =
        new ReflexInput(
            self,
            input(self, Optional.empty(), List.of()).snapshot(),
            decision(self, List.of(new Waypoint(far, Hop.WALK))),
            Optional.empty(),
            0,
            Optional.empty());

    assertThat(first(Kit.GRAPPLER, input, 0))
        .contains(new BodyCommand.UseKit(2, Optional.empty(), Optional.of(far)));
  }

  private static int slotOf(Kit kit, String item) {
    return Loadouts.rwf(kit).kitItems().stream()
        .filter(kitItem -> kitItem.move().item().equals(item))
        .findFirst()
        .orElseThrow()
        .slot();
  }

  @Test
  void aSacrificialBondsTheNearestAllyInReach() {
    var self = with(combatant(1, RED, HERE), Kit.SACRIFICIAL, 20);
    var near = with(combatant(2, RED, HERE.plus(2, 0, 0)), Kit.TROOPER, 20);
    var farther = with(combatant(3, RED, HERE.plus(2.5, 0, 0)), Kit.TROOPER, 20);
    var out = with(combatant(4, RED, HERE.plus(8, 0, 0)), Kit.TROOPER, 20);
    var dye = slotOf(Kit.SACRIFICIAL, "RED_DYE");

    assertThat(first(Kit.SACRIFICIAL, input(self, Optional.empty(), List.of(farther, near)), 0))
        .contains(new BodyCommand.UseKit(dye, Optional.of(near.id()), Optional.empty()));
    assertThat(first(Kit.SACRIFICIAL, input(self, Optional.empty(), List.of(out)), 0)).isEmpty();
  }

  @Test
  void aHurtSacrificialSnipsItsBonds() {
    var self = with(combatant(1, RED, HERE), Kit.SACRIFICIAL, 6);
    var shears = slotOf(Kit.SACRIFICIAL, "SHEARS");

    assertThat(first(Kit.SACRIFICIAL, input(self, Optional.empty(), List.of()), 0))
        .contains(new BodyCommand.UseKit(shears, Optional.empty(), Optional.empty()));
  }

  @Test
  void aTeleporterPutsAPadUnderItsFarthestTeammateWithTheRemote() {
    var self = with(combatant(1, RED, HERE), Kit.TELEPORTER, 20);
    var near = with(combatant(2, RED, HERE.plus(10, 0, 0)), Kit.TROOPER, 20);
    var far = with(combatant(3, RED, HERE.plus(60, 0, 0)), Kit.TROOPER, 20);
    var farther = with(combatant(4, RED, HERE.plus(90, 0, 0)), Kit.TROOPER, 20);
    var enemy = with(combatant(5, BLUE, HERE.plus(6, 0, 0)), Kit.TROOPER, 20);
    var remote = slotOf(Kit.TELEPORTER, "MAP");
    var waiting = input(self, Optional.empty(), List.of(near, far, farther));

    assertThat(
            Loadouts.rwf(Kit.TELEPORTER).kitItems().stream()
                .map(item -> KitPlay.choose(item, waiting, 1))
                .flatMap(Optional::stream)
                .toList())
        .contains(new BodyCommand.UseKit(remote, Optional.of(farther.id()), Optional.empty()));
    var fighting = input(self, Optional.of(enemy), List.of(far));
    assertThat(
            Loadouts.rwf(Kit.TELEPORTER).kitItems().stream()
                .map(item -> KitPlay.choose(item, fighting, 1))
                .flatMap(Optional::stream)
                .toList())
        .isEmpty();
  }

  @Test
  void aDwarfSneaksWhileItWaitsAndAnInertiaChargesStraightIn() {
    var dwarf = with(combatant(1, RED, HERE), Kit.DWARF, 20);
    var dwarfContext = new ReflexContext(NAV.grid(), levers(1), Loadouts.rwf(Kit.DWARF));
    var world =
        new WorldSnapshot(
            1,
            MatchPhase.LIVE,
            List.of(dwarf),
            List.of(),
            PoisonView.NONE,
            "synthetic",
            List.of(),
            List.of());
    var waiting = new ReflexInput(dwarf, world, decision(dwarf, List.of()), Optional.empty(), 0, Optional.empty());
    var commands =
        Reflex.tick(
                ReflexState.initial(dwarf.facing()), waiting, dwarfContext, new SplittableRandom(1))
            .commands();
    assertThat(commands).contains(new BodyCommand.Sneak(true));

    var inertia = with(combatant(1, RED, HERE), Kit.INERTIA, 20);
    var enemy = with(combatant(2, BLUE, HERE.plus(12, 0, 0)), Kit.TROOPER, 20);
    var inertiaContext = new ReflexContext(NAV.grid(), levers(1), Loadouts.rwf(Kit.INERTIA));
    var fight =
        new WorldSnapshot(
            1,
            MatchPhase.LIVE,
            List.of(inertia, enemy),
            List.of(),
            PoisonView.NONE,
            "synthetic",
            List.of(),
            List.of());
    var charging =
        new ReflexInput(
            inertia, fight, decision(inertia, List.of()), Optional.of(enemy), 0, Optional.empty());
    var moves =
        Reflex.tick(
                ReflexState.initial(inertia.facing()),
                charging,
                inertiaContext,
                new SplittableRandom(1))
            .commands()
            .stream()
            .filter(BodyCommand.MoveToward.class::isInstance)
            .map(BodyCommand.MoveToward.class::cast)
            .toList();
    assertThat(moves).isNotEmpty();
    var move = moves.getFirst();
    assertThat(move.sprint()).isTrue();
    // Straight at the enemy: no sideways part.
    assertThat(move.waypoint().z())
        .isCloseTo(HERE.z(), org.assertj.core.api.Assertions.within(1e-9));
  }

  @Test
  void theReflexSpacesKitUsesByTheItemsGap() {
    var self = with(combatant(1, RED, HERE), Kit.MEDIC, 20);
    var ally = with(combatant(2, RED, HERE.plus(2, 0, 0)), Kit.TROOPER, 8);
    var context = new ReflexContext(NAV.grid(), levers(1), Loadouts.rwf(Kit.MEDIC));
    var state = ReflexState.initial(self.facing());
    var uses = 0;
    for (var tick = 1; tick <= 40; tick++) {
      var world =
          new WorldSnapshot(
              tick,
              MatchPhase.LIVE,
              List.of(self, ally),
              List.of(),
              PoisonView.NONE,
              "synthetic",
              List.of(),
              List.of());
      var input =
          new ReflexInput(
              self, world, decision(self, List.of()), Optional.empty(), 0, Optional.empty());
      var step = Reflex.tick(state, input, context, new SplittableRandom(tick));
      state = step.state();
      uses += (int) step.commands().stream().filter(BodyCommand.UseKit.class::isInstance).count();
    }

    assertThat(uses).isEqualTo(2);
  }
}
