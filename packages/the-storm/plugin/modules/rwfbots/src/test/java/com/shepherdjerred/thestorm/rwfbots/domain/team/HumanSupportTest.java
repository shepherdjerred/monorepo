package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TrainingYardNav;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
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
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/**
 * Bots look after the humans on their team on the training yard: an arming or fighting human gets
 * the nearby bots, every human gets one bot's company in a team big enough to spare it, and the
 * planter, the anchors and the bound hold whatever the humans do.
 */
final class HumanSupportTest {

  private static final NavArtifact NAV = TrainingYardNav.NAV;
  private static final BombId RED_BOMB = new BombId(0);
  private static final BombId BLUE_BOMB = new BombId(1);
  private static final BombId NUKE = new BombId(2);
  private static final CombatantId HUMAN = new CombatantId(50);

  private static Vec3 bomb(String name) {
    return NAV.sites().bomb(name).orElseThrow().cell().center();
  }

  /** The walkable point nearest {@code at}. */
  private static Vec3 ground(Vec3 at) {
    return NAV.graph().feet(NAV.graph().nearestNodeWithin(at, 6).orElseThrow());
  }

  private static List<BombView> bombs(BombState blue) {
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
      out.add(
          new BombView(
              id, owner, site.cell().center(), id.equals(BLUE_BOMB) ? blue : new BombState.Idle()));
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

  private static WorldSnapshot snapshot(
      long tick, List<CombatantView> bots, List<CombatantView> humans, BombState blue) {
    var everyone = new ArrayList<CombatantView>(bots);
    everyone.addAll(humans);
    for (var i = 0; i < bots.size() + humans.size(); i++) {
      everyone.add(Fixtures.combatant(99 + i, BLUE, NAV.sites().spawns().getLast().cell().feet()));
    }
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        everyone,
        bombs(blue),
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

  private static Blackboard deal(
      Blackboard board, long tick, List<CombatantView> bots, List<CombatantView> humans) {
    return deal(board, snapshot(tick, bots, humans, new BombState.Idle()), bots);
  }

  private static Blackboard deal(Blackboard board, WorldSnapshot world, List<CombatantView> bots) {
    return TeamBrain.tick(
        board,
        new TeamBrain.TeamSituation(NAV, world, bots, members(bots)),
        new SplittableRandom(1));
  }

  private static List<Slot> support(TeamPlan plan, CombatantId human) {
    return plan.slots().stream()
        .filter(slot -> slot.buddy().filter(human::equals).isPresent())
        .toList();
  }

  private static List<CombatantId> holders(TeamPlan plan, CombatantId human) {
    var keys = support(plan, human).stream().map(Slot::key).toList();
    return plan.assignment().entrySet().stream()
        .filter(entry -> keys.contains(entry.getValue()))
        .map(Map.Entry::getKey)
        .sorted()
        .toList();
  }

  /** Six bots at red's spawns, two of them moved up near the blue bomb. */
  private static List<CombatantView> sixWithTwoForward() {
    var bots = new ArrayList<>(reds(6));
    var fuse = bomb("blue-1");
    bots.set(4, bots.get(4).withPos(ground(fuse.plus(-12, 0, 6))));
    bots.set(5, bots.get(5).withPos(ground(fuse.plus(-12, 0, -6))));
    return bots;
  }

  @Test
  void aHumanArmingABombGetsTheTwoNearbyBotsToCoverThem() {
    var bots = sixWithTwoForward();
    var human = Fixtures.combatant(HUMAN.value(), RED, ground(bomb("blue-1").plus(-2, 0, 0)));
    var board =
        deal(
            Blackboard.open(RED, Strategy.RUSH),
            snapshot(0, bots, List.of(human), new BombState.Arming(RED, 0.2, 1)),
            bots);
    var plan = board.plan();
    var cover = support(plan, HUMAN);
    assertThat(cover).hasSize(HumanSupport.URGENT);
    assertThat(cover)
        .allSatisfy(
            slot -> {
              assertThat(slot.role()).isEqualTo(Role.ESCORT);
              assertThat(Math.abs(slot.side())).isEqualTo(HumanSupport.COVER_SIDE);
            });
    assertThat(holders(plan, HUMAN)).containsExactly(bots.get(4).id(), bots.get(5).id());
    // The team's own plan still stands: a planter, and one slot per bot.
    assertThat(plan.holderOf("plant-0")).isPresent();
    assertThat(plan.slots()).hasSize(bots.size());
  }

  @Test
  void aHumanGuardingTheBombTheyLitKeepsTheirCover() {
    var bots = sixWithTwoForward();
    var human = Fixtures.combatant(HUMAN.value(), RED, ground(bomb("blue-1").plus(-5, 0, 0)));
    var plan =
        deal(
                Blackboard.open(RED, Strategy.RUSH),
                snapshot(0, bots, List.of(human), new BombState.Armed(900)),
                bots)
            .plan();
    assertThat(support(plan, HUMAN))
        .hasSize(HumanSupport.URGENT)
        .allSatisfy(slot -> assertThat(Math.abs(slot.side())).isEqualTo(HumanSupport.COVER_SIDE));
  }

  @Test
  void aHumanWithAnEnemyOnThemGetsTheNearbyBots() {
    var bots = sixWithTwoForward();
    var at = ground(bomb("blue-1").plus(-8, 0, 0));
    var human = Fixtures.combatant(HUMAN.value(), RED, at);
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .share(
                List.of(
                    new SharedSighting(
                        new CombatantId(99),
                        at.plus(5, 0, 0),
                        Vec3.ZERO,
                        10,
                        10,
                        bots.get(4).id())),
                1,
                10,
                new SplittableRandom(1));
    var plan = deal(board, 12, bots, List.of(human)).plan();
    assertThat(support(plan, HUMAN))
        .hasSize(2)
        .allSatisfy(slot -> assertThat(slot.watch()).isEqualTo(at.plus(5, 0, 0)));
    assertThat(holders(plan, HUMAN)).containsExactly(bots.get(4).id(), bots.get(5).id());
  }

  @Test
  void onlyBotsWithinReachComeToAnUrgentCall() {
    // Everyone is back at spawn, far beyond NEARBY of a human arming the blue bomb: nobody is sent
    // across the yard, and the human keeps one bot's company.
    var bots = reds(6);
    var human = Fixtures.combatant(HUMAN.value(), RED, ground(bomb("blue-1").plus(-2, 0, 0)));
    assertThat(bots)
        .allSatisfy(
            bot -> assertThat(bot.pos().distance(human.pos())).isGreaterThan(HumanSupport.NEARBY));
    var plan =
        deal(
                Blackboard.open(RED, Strategy.RUSH),
                snapshot(0, bots, List.of(human), new BombState.Arming(RED, 0.2, 1)),
                bots)
            .plan();
    assertThat(support(plan, HUMAN))
        .singleElement()
        .satisfies(slot -> assertThat(Math.abs(slot.side())).isEqualTo(HumanSupport.COMPANY_SIDE));
  }

  @Test
  void aHumanKeepsOneBotsCompanyOnceTheTeamCanSpareIt() {
    var human = Fixtures.combatant(HUMAN.value(), RED, reds(8).getLast().pos());
    for (var size = 1; size <= 8; size++) {
      var plan = deal(Blackboard.open(RED, Strategy.SPLIT), 0, reds(size), List.of(human)).plan();
      assertThat(support(plan, HUMAN))
          .as("team of %d", size)
          .hasSize(size >= HumanSupport.COMPANY_TEAM ? 1 : 0);
      assertThat(plan.slots()).hasSize(size);
    }
  }

  @Test
  void supportNeverTakesThePlanterOrTheAnchorsAndIsBounded() {
    var bots = reds(8);
    var humans = new ArrayList<CombatantView>();
    var fuse = bomb("blue-1");
    for (var i = 0; i < 4; i++) {
      var at = ground(fuse.plus(-14, 0, -6 + 4 * i));
      humans.add(Fixtures.combatant(60 + i, RED, at));
      bots.set(i, bots.get(i).withPos(at.plus(0, 0, 1)));
    }
    var board = Blackboard.open(RED, Strategy.TURTLE);
    for (var human : humans) {
      board =
          board.share(
              List.of(
                  new SharedSighting(
                      new CombatantId(99 + human.id().value()),
                      human.pos().plus(4, 0, 0),
                      Vec3.ZERO,
                      10,
                      10,
                      bots.getFirst().id())),
              1,
              10,
              new SplittableRandom(1));
    }
    var plan = deal(board, 12, bots, humans).plan();
    var supports = plan.slots().stream().filter(slot -> slot.buddy().isPresent()).toList();
    assertThat(supports).hasSizeLessThanOrEqualTo(HumanSupport.cap(bots.size()));
    assertThat(supports).isNotEmpty();
    assertThat(plan.slots().stream().filter(slot -> slot.kind() == SlotKind.PLANT)).hasSize(1);
    assertThat(plan.slots().stream().filter(slot -> slot.kind() == SlotKind.ANCHOR))
        .hasSize(
            (int)
                Playbook.wants(Strategy.TURTLE, 8, true).stream()
                    .filter(want -> want.kind() == SlotKind.ANCHOR)
                    .count());
    assertThat(HumanSupport.cap(36)).isEqualTo(HumanSupport.MAX_TOTAL);
  }

  @Test
  void aHumanWhoStartsArmingIsCoveredBeforeTheNextPeriodicDeal() {
    var bots = sixWithTwoForward();
    var human = Fixtures.combatant(HUMAN.value(), RED, ground(bomb("blue-1").plus(-2, 0, 0)));
    var first = deal(Blackboard.open(RED, Strategy.RUSH), 0, bots, List.of(human));
    assertThat(support(first.plan(), HUMAN))
        .allSatisfy(slot -> assertThat(slot.side()).isNotEqualTo(HumanSupport.COVER_SIDE));
    var tick = TeamBrain.HANDOFF_PERIOD_TICKS;
    var quiet = deal(first, tick, bots, List.of(human));
    assertThat(quiet.rolesAssignedTick()).as("nothing changed, no deal").isZero();
    var arming =
        deal(first, snapshot(tick, bots, List.of(human), new BombState.Arming(RED, 0.1, 1)), bots);
    assertThat(arming.rolesAssignedTick()).isEqualTo(tick);
    assertThat(support(arming.plan(), HUMAN)).hasSize(2);
    assertThat(holders(arming.plan(), HUMAN)).contains(bots.get(4).id(), bots.get(5).id());
  }

  @Test
  void aBotFarFromItsHumanPaysForTheSupportSlot() {
    var human = Fixtures.combatant(HUMAN.value(), RED, new Vec3(0, 65, 0));
    var slot =
        new Slot(
            Slot.supportKey(HUMAN, 0),
            SlotKind.ESCORT,
            Role.ESCORT,
            human.pos(),
            human.pos(),
            -1,
            -1,
            Optional.empty(),
            HumanSupport.COVER_SIDE);
    var world = snapshot(0, List.of(), List.of(human), new BombState.Idle());
    var near = Fixtures.combatant(1, RED, new Vec3(10, 65, 0));
    var far = Fixtures.combatant(2, RED, new Vec3(HumanSupport.NEARBY + 5, 65, 0));
    assertThat(HumanSupport.cost(slot, near, world)).isZero();
    assertThat(HumanSupport.cost(slot, far, world)).isEqualTo(HumanSupport.FAR);
  }
}
