package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TrainingYardNav;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** The playbook and the team step on the shipped training yard. */
final class PlaybookTest {

  private static final com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact NAV =
      TrainingYardNav.NAV;

  private static final BombId RED_BOMB = new BombId(0);
  private static final BombId BLUE_BOMB = new BombId(1);
  private static final BombId NUKE = new BombId(2);

  private static List<BombView> bombs() {
    var out = new ArrayList<BombView>();
    for (var site : NAV.sites().bombs()) {
      var id =
          switch (site.name()) {
            case "red-1" -> RED_BOMB;
            case "blue-1" -> BLUE_BOMB;
            default -> NUKE;
          };
      var owner =
          site.team()
              .<BombOwner>map(team -> new BombOwner.Team(new TeamId(team)))
              .orElseGet(BombOwner.Nuke::new);
      out.add(new BombView(id, owner, site.cell().center(), new BombState.Idle()));
    }
    return out;
  }

  /** {@code size} red bots on red's spawns. */
  private static List<CombatantView> reds(int size) {
    var spawns =
        NAV.sites().spawns().stream()
            .filter(site -> site.team().orElseThrow().equals("red"))
            .sorted((a, b) -> a.name().compareTo(b.name()))
            .toList();
    var out = new ArrayList<CombatantView>();
    for (var i = 0; i < size; i++) {
      out.add(Fixtures.combatant(i + 1, RED, spawns.get(i).cell().feet()));
    }
    return out;
  }

  private static WorldSnapshot snapshot(long tick, List<CombatantView> bots) {
    var everyone = new ArrayList<>(bots);
    everyone.add(Fixtures.combatant(99, BLUE, NAV.sites().spawns().getLast().cell().feet()));
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        everyone,
        bombs(),
        PoisonView.NONE,
        NAV.mapId(),
        List.of(),
        List.of(),
        List.of());
  }

  private static Map<CombatantId, SlotFit.Member> members(List<CombatantView> bots) {
    var out = new HashMap<CombatantId, SlotFit.Member>();
    for (var bot : bots) {
      out.put(
          bot.id(),
          new SlotFit.Member(
              Archetype.TACTICIAN,
              Set.of(),
              Map.of(Role.PLANT, 1.0, Role.ESCORT, 0.8),
              Kit.TROOPER));
    }
    return out;
  }

  private static Blackboard deal(Strategy strategy, List<CombatantView> bots, long tick) {
    return TeamBrain.tick(
        Blackboard.open(RED, strategy),
        new TeamBrain.TeamSituation(NAV, snapshot(tick, bots), bots, members(bots)),
        new SplittableRandom(1));
  }

  @Test
  void everyStrategyDealsOneSlotPerBotSpacedApart() {
    for (var strategy : Strategy.values()) {
      for (var size = 1; size <= 8; size++) {
        var plan = deal(strategy, reds(size), 0).plan();
        assertThat(plan.slots()).as("%s %d", strategy, size).hasSize(size);
        assertThat(plan.assignment()).hasSize(size);
        assertThat(new HashSet<>(plan.assignment().values())).hasSize(size);
        assertSpaced(plan, strategy + " " + size);
      }
    }
  }

  /** Every two slots that stay put are at least {@link Playbook#SPACING} apart. */
  private static void assertSpaced(TeamPlan plan, String what) {
    var fixed = plan.slots().stream().filter(slot -> slot.kind() != SlotKind.ESCORT).toList();
    for (var i = 0; i < fixed.size(); i++) {
      for (var j = i + 1; j < fixed.size(); j++) {
        var a = fixed.get(i);
        var b = fixed.get(j);
        assertThat(a.pos().horizontalDistance(b.pos()))
            .as("%s: %s to %s", what, a.key(), b.key())
            .isGreaterThanOrEqualTo(Playbook.SPACING);
      }
    }
  }

  @Test
  void turtleAnchorsScreenTheApproachesOutsideTheBombsBase() {
    var plan = deal(Strategy.TURTLE, reds(8), 0).plan();
    var guard =
        bombs().stream().filter(bomb -> bomb.id().equals(RED_BOMB)).findFirst().orElseThrow();
    var anchors = plan.slots().stream().filter(slot -> slot.kind() == SlotKind.ANCHOR).toList();
    assertThat(anchors).hasSize(2);
    for (var anchor : anchors) {
      assertThat(anchor.pos().horizontalDistance(guard.pos()))
          .isGreaterThanOrEqualTo(Playbook.ANCHOR_MIN);
    }
    var width =
        anchors.stream().mapToDouble(slot -> slot.pos().z()).max().orElseThrow()
            - anchors.stream().mapToDouble(slot -> slot.pos().z()).min().orElseThrow();
    assertThat(width).isGreaterThanOrEqualTo(16);
  }

  @Test
  void escortsFormAWedgeBehindThePlanterNotAStack() {
    var plan = deal(Strategy.RUSH, reds(3), 0).plan();
    var escorts = plan.slots().stream().filter(slot -> slot.kind() == SlotKind.ESCORT).toList();
    assertThat(escorts).hasSize(2);
    assertThat(escorts.get(0).side()).isEqualTo(-escorts.get(1).side());
    var planter = new com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3(20, 65, 31);
    var heading = new com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3(1, 0, 0);
    var left = Playbook.escortPoint(planter, heading, Playbook.ESCORT_SIDE);
    var right = Playbook.escortPoint(planter, heading, -Playbook.ESCORT_SIDE);
    assertThat(left.horizontalDistance(planter)).isGreaterThanOrEqualTo(Playbook.SPACING);
    assertThat(left.horizontalDistance(right)).isGreaterThanOrEqualTo(Playbook.SPACING);
    assertThat(left.x()).isLessThan(planter.x());
  }

  @Test
  void everyStrategyKeepsRoughlyThreeAttackersForEachDefender() {
    for (var strategy : Strategy.values()) {
      for (var size = 4; size <= 32; size++) {
        var wants = Playbook.wants(strategy, size, true);
        assertThat(wants.stream().filter(want -> want.kind() == SlotKind.ANCHOR).count())
            .as("%s team size %d", strategy, size)
            .isEqualTo(Math.round(size / 4.0));
      }
    }
  }

  @Test
  void rushesAndSplitsUseLanesOnBothSidesOfTheYard() {
    for (var strategy : List.of(Strategy.RUSH, Strategy.SPLIT)) {
      var plan = deal(strategy, reds(8), 0).plan();
      assertThat(plan.lanes()).hasSizeGreaterThanOrEqualTo(2);
      var lanes = new HashSet<Integer>();
      for (var slot : plan.slots()) {
        if (slot.kind() == SlotKind.LANE || slot.kind() == SlotKind.FLANK) {
          lanes.add(slot.lane());
        }
      }
      assertThat(lanes).as("%s", strategy).hasSizeGreaterThanOrEqualTo(2);
      var widest =
          plan.slots().stream().mapToDouble(slot -> slot.pos().z()).max().orElseThrow()
              - plan.slots().stream().mapToDouble(slot -> slot.pos().z()).min().orElseThrow();
      assertThat(widest).as("%s spread across the yard", strategy).isGreaterThan(15);
    }
  }

  @Test
  void defenderBalancingPreservesSideAttackRoutesOnSmallAndSplitTeams() {
    var rush = Playbook.wants(Strategy.RUSH, 4, true);
    assertThat(rush.stream().filter(want -> want.kind() == SlotKind.LANE).map(Playbook.Want::which))
        .contains(Lanes.Which.LEFT);
    var split = Playbook.wants(Strategy.SPLIT, 8, true);
    assertThat(
            split.stream()
                .filter(want -> want.kind() == SlotKind.LANE || want.kind() == SlotKind.FLANK)
                .map(Playbook.Want::which))
        .contains(Lanes.Which.LEFT, Lanes.Which.RIGHT);
  }

  @Test
  void theStrategyNotProximityPicksTheNuke() {
    assertThat(deal(Strategy.RUSH, reds(1), 0).plan().objective().orElseThrow())
        .isEqualTo(BLUE_BOMB);
    assertThat(deal(Strategy.SPLIT, reds(1), 0).plan().objective().orElseThrow())
        .isEqualTo(BLUE_BOMB);
    assertThat(deal(Strategy.HUNT, reds(1), 0).plan().objective().orElseThrow()).isEqualTo(NUKE);
    assertThat(deal(Strategy.TURTLE, reds(1), 0).plan().objective().orElseThrow()).isEqualTo(NUKE);
  }

  @Test
  void aNukeLoverTakesTheSlotThatArmsTheNuke() {
    var bots = reds(4);
    var members = new HashMap<>(members(bots));
    var lover = bots.get(3).id();
    members.put(
        lover,
        new SlotFit.Member(
            Archetype.TACTICIAN,
            Set.of(Quirk.LOVES_NUKE),
            Map.of(Role.PLANT, 1.0, Role.ESCORT, 0.8),
            Kit.TROOPER));
    var board =
        TeamBrain.tick(
            Blackboard.open(RED, Strategy.HUNT),
            new TeamBrain.TeamSituation(NAV, snapshot(0, bots), bots, members),
            new SplittableRandom(1));
    assertThat(board.plan().objective()).contains(NUKE);
    assertThat(board.plan().slotOf(lover).orElseThrow().kind()).isEqualTo(SlotKind.PLANT);
  }

  @Test
  void botsKeepTheirSlotsAcrossDealsUnlessClearlyBetterOff() {
    var bots = reds(6);
    var first = deal(Strategy.SPLIT, bots, 0);
    var again =
        TeamBrain.tick(
            first,
            new TeamBrain.TeamSituation(
                NAV, snapshot(TeamBrain.ROLE_PERIOD_TICKS, bots), bots, members(bots)),
            new SplittableRandom(2));
    assertThat(again.rolesAssignedTick()).isEqualTo(TeamBrain.ROLE_PERIOD_TICKS);
    assertThat(again.plan().assignment()).isEqualTo(first.plan().assignment());
  }

  @Test
  void anArchetypeTakesTheSlotItWants() {
    var bots = reds(8);
    var members = new HashMap<>(members(bots));
    var sniper = bots.get(0).id();
    var anchor = bots.get(1).id();
    members.put(
        sniper,
        new SlotFit.Member(Archetype.SNIPER, Set.of(), Map.of(Role.ROTATE, 1.0), Kit.LONGBOW));
    members.put(
        anchor,
        new SlotFit.Member(Archetype.ANCHOR, Set.of(), Map.of(Role.DEFEND, 1.0), Kit.TROOPER));
    var board =
        TeamBrain.tick(
            Blackboard.open(RED, Strategy.SPLIT),
            new TeamBrain.TeamSituation(NAV, snapshot(0, bots), bots, members),
            new SplittableRandom(1));
    assertThat(board.plan().slotOf(sniper).orElseThrow().kind()).isEqualTo(SlotKind.OVERWATCH);
    assertThat(board.plan().slotOf(anchor).orElseThrow().kind()).isEqualTo(SlotKind.ANCHOR);
  }

  /** Open floor with a shallow pond from x = 9 east. */
  private record PondField() implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 0, 0), 16, 4, 16);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (y == 0) return BlockShape.FULL;
      return y == 1 && x >= 9 ? BlockShape.LIQUID : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  @Test
  void noSlotIsDealtInWater() {
    // hemispheres: a defender's slot snapped into a pond, and it trod water there all match.
    var nav = MapBaker.bake("pond-field", new PondField(), new NavSites(List.of(), List.of()));
    assertThat(nav.graph().nodeAt(new BlockPos(12, 1, 8))).as("the pond is swimmable").isPresent();
    var pond = new Vec3(12.5, 1, 8.5);
    for (var strategy : Strategy.values()) {
      var slots =
          Playbook.deal(
              new Playbook.Setup(
                  nav,
                  strategy,
                  6,
                  new Vec3(2.5, 1, 2.5),
                  Optional.empty(),
                  List.of(),
                  pond,
                  0,
                  pond,
                  1,
                  List.of(pond),
                  pond,
                  Set.of()));
      assertThat(slots)
          .as(strategy.name())
          .allSatisfy(slot -> assertThat(slot.pos().x()).isLessThan(9));
    }
  }
}
