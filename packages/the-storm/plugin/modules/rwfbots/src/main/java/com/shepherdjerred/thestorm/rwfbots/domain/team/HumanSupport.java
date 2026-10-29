package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * How a team's bots look after the human players on their team. In production a human had a bot
 * within 8 blocks a third of their alive time (bots had one two thirds of theirs), most of their
 * deaths came with no teammate within 12, and an arming human got neither escort nor cover. So a
 * deal turns a few of the playbook's least important slots into support slots that move with a
 * human ({@link Slot#buddy}):
 *
 * <ul>
 *   <li>{@link Need#ARMING}: a human arming an enemy bomb, or guarding it as it burns down, gets up
 *       to {@link #URGENT} nearby bots to cover them; as escorts they also click the fuse, each one
 *       a second off the arm time.
 *   <li>{@link Need#ENGAGED}: a human with an enemy on them gets up to {@link #URGENT} nearby bots.
 *   <li>{@link Need#COMPANY}: otherwise, in a team of at least {@link #COMPANY_TEAM} bots, one bot
 *       walks loosely beside each human.
 * </ul>
 *
 * <p>Support is bounded so the playbook still works: never the planter, the anchors or a retake, at
 * most a third of the team ({@link #MAX_TOTAL} at most), and urgent help only from bots within
 * {@link #NEARBY}. Pure.
 */
public final class HumanSupport {

  /** A human whose feet are this close to an enemy bomb their team is arming is the one arming. */
  static final double ARMING_REACH = 4.5;

  /**
   * A human this close to an enemy bomb burning down is guarding the fuse they lit: the enemy comes
   * to defuse it, so the cover stays.
   */
  static final double GUARD_REACH = 8;

  /** A sighting this close to a human, this recently, means an enemy is on them. */
  static final double ENGAGED_NEAR = 12;

  static final long ENGAGED_RECENT = 60;

  /** A human hurt this recently with an enemy seen within {@link #NEARBY_ENEMY} is in a fight. */
  static final long HURT_RECENT = 30;

  static final double NEARBY_ENEMY = 24;

  /** Only bots within this many blocks of a human come to its urgent help. */
  public static final double NEARBY = 40;

  /** At most this many bots answer one human's urgent call. */
  public static final int URGENT = 2;

  /** The least number of living bots that spares one for a human's company. */
  public static final int COMPANY_TEAM = 4;

  /** The most support slots one deal hands out, whatever the team's size. */
  public static final int MAX_TOTAL = 4;

  /** How far beside an arming or fighting human a cover slot stands. */
  public static final double COVER_SIDE = 3;

  /** How far beside a human its company walks. */
  public static final double COMPANY_SIDE = 4.5;

  /** What a support slot costs a bot further than {@link #NEARBY} from its human. */
  static final double FAR = 4;

  private HumanSupport() {}

  /** Why a human gets support. */
  public enum Need {
    ARMING,
    ENGAGED,
    COMPANY;

    /** Whether the human needs help now rather than company. */
    public boolean urgent() {
      return this != COMPANY;
    }
  }

  /**
   * One human's call for support.
   *
   * @param human who
   * @param need why
   * @param watch where its supporters look: the enemy on them, else up the field
   * @param bots how many support slots it gets
   */
  public record Call(CombatantId human, Need need, Vec3 watch, int bots) {}

  /** The need of {@code human} at {@code snapshot}'s tick, as {@code board} knows it. */
  public static Need need(Blackboard board, WorldSnapshot snapshot, CombatantView human) {
    if (arming(snapshot, human).isPresent()) return Need.ARMING;
    return threat(board, snapshot, human).isPresent() ? Need.ENGAGED : Need.COMPANY;
  }

  /**
   * The enemy bomb {@code human} is arming right now, or guarding once it burns down, if any: the
   * planter's cover stays while the enemy comes to defuse.
   */
  public static Optional<BombView> arming(WorldSnapshot snapshot, CombatantView human) {
    return snapshot.bombs().stream()
        .filter(bomb -> !bomb.belongsTo(human.team()))
        .filter(
            bomb ->
                bomb.state() instanceof BombState.Arming(var team, var _, var _)
                    ? team.equals(human.team())
                        && bomb.pos().horizontalDistance(human.pos()) <= ARMING_REACH
                    : bomb.state().isLit()
                        && bomb.pos().horizontalDistance(human.pos()) <= GUARD_REACH)
        .findFirst();
  }

  /**
   * The sighting that puts an enemy on {@code human}: the nearest one within {@link #ENGAGED_NEAR}
   * seen in the last {@link #ENGAGED_RECENT} ticks, or, when the human was just hurt, within {@link
   * #NEARBY_ENEMY}.
   */
  static Optional<Vec3> threat(Blackboard board, WorldSnapshot snapshot, CombatantView human) {
    var now = snapshot.tick();
    var hurt = human.lastHurtTick() >= 0 && now - human.lastHurtTick() <= HURT_RECENT;
    var reach = hurt ? NEARBY_ENEMY : ENGAGED_NEAR;
    return board.visibleSightings(now).stream()
        .filter(sighting -> now - sighting.seenTick() <= ENGAGED_RECENT)
        .map(SharedSighting::pos)
        .filter(pos -> pos.distance(human.pos()) <= reach)
        .min(Comparator.comparingDouble(pos -> pos.distance(human.pos())));
  }

  /** The most support slots a team of {@code bots} living bots hands out. */
  public static int cap(int bots) {
    return bots < 2 ? 0 : Math.min(MAX_TOTAL, Math.max(1, bots / 3));
  }

  /**
   * The calls of the living humans on {@code board}'s team, most urgent first, then by id, bounded
   * by {@link #cap}. {@code bots} are the team's living bots; {@code home} is where the team
   * starts, to face company up the field.
   */
  public static List<Call> calls(
      Blackboard board, TeamBrain.TeamSituation situation, List<CombatantView> bots, Vec3 home) {
    var snapshot = situation.snapshot();
    var calls = new ArrayList<Call>();
    for (var human :
        situation.humans(board.team()).stream()
            .sorted(Comparator.comparing(CombatantView::id))
            .toList()) {
      var need = need(board, snapshot, human);
      var nearby =
          (int)
              bots.stream()
                  .filter(bot -> bot.pos().distance(human.pos()) <= NEARBY)
                  .limit(URGENT)
                  .count();
      if (need.urgent() && nearby == 0) need = Need.COMPANY;
      if (need == Need.COMPANY && bots.size() < COMPANY_TEAM) continue;
      var watch =
          threat(board, snapshot, human)
              .orElseGet(() -> ahead(human.pos(), home, arming(snapshot, human)));
      calls.add(new Call(human.id(), need, watch, need.urgent() ? nearby : 1));
    }
    calls.sort(Comparator.comparing((Call call) -> call.need()).thenComparing(Call::human));
    var bounded = new ArrayList<Call>();
    var left = cap(bots.size());
    for (var call : calls) {
      if (left <= 0) break;
      var granted = Math.min(call.bots(), left);
      bounded.add(new Call(call.human(), call.need(), call.watch(), granted));
      left -= granted;
    }
    return bounded;
  }

  /** Up the field from {@code from}: away from home, past the bomb being armed. */
  private static Vec3 ahead(Vec3 from, Vec3 home, Optional<BombView> bomb) {
    var away = from.minus(home).horizontal();
    var base = bomb.map(BombView::pos).orElse(from);
    return away.isZero() ? base.plus(8, 0, 0) : base.plus(away.normalized().scale(12));
  }

  /**
   * {@code slots} with the least important of them made support slots for {@code calls}: from the
   * end of the deal, lane, flank, overwatch and sweep slots, and for an urgent call also the
   * planter's escorts. The planter, anchors and retakes are never taken. Support slots stand beside
   * their human, keyed after them ({@link Slot#supportKey}).
   */
  public static List<Slot> adapt(
      List<Slot> slots, List<Call> calls, Map<CombatantId, CombatantView> humans) {
    var out = new ArrayList<>(slots);
    for (var call : calls) {
      var human = humans.get(call.human());
      if (human == null) throw new IllegalArgumentException("no human " + call.human());
      for (var n = 0; n < call.bots(); n++) {
        var index = spare(out, call.need().urgent());
        if (index < 0) return out;
        var width = call.need().urgent() ? COVER_SIDE : COMPANY_SIDE;
        var side = n % 2 == 0 ? width : -width;
        out.set(
            index,
            new Slot(
                Slot.supportKey(call.human(), n),
                SlotKind.ESCORT,
                Role.ESCORT,
                human.pos(),
                call.watch(),
                -1,
                -1,
                Optional.empty(),
                side));
      }
    }
    return out;
  }

  /** The last slot a call may take, or -1. */
  private static int spare(List<Slot> slots, boolean urgent) {
    for (var index = slots.size() - 1; index >= 0; index--) {
      var slot = slots.get(index);
      if (slot.buddy().isPresent() || slot.role() == Role.RETAKE) continue;
      switch (slot.kind()) {
        case LANE, FLANK, OVERWATCH, SWEEP -> {
          return index;
        }
        default -> {}
      }
    }
    if (!urgent) return -1;
    for (var index = slots.size() - 1; index >= 0; index--) {
      var slot = slots.get(index);
      if (slot.buddy().isEmpty() && slot.kind() == SlotKind.ESCORT) return index;
    }
    return -1;
  }

  /**
   * What holding {@code slot} costs a bot at {@code bot}: a support slot is no job for a bot
   * further than {@link #NEARBY} from its human.
   */
  static double cost(Slot slot, CombatantView bot, WorldSnapshot snapshot) {
    return slot.buddy()
        .flatMap(snapshot::combatant)
        .filter(human -> human.pos().distance(bot.pos()) > NEARBY)
        .map(human -> FAR)
        .orElse(0.0);
  }

  /**
   * Whether {@code plan} dealt each human it supports urgent cover rather than company: an arming
   * or fighting human whose deal still gives them company only is due a new deal.
   */
  static Map<CombatantId, Boolean> served(TeamPlan plan) {
    var out = new HashMap<CombatantId, Boolean>();
    for (var slot : plan.slots()) {
      slot.buddy()
          .ifPresent(
              human -> out.merge(human, Math.abs(slot.side()) == COVER_SIDE, Boolean::logicalOr));
    }
    return out;
  }

  /**
   * Whether the support of {@code board}'s team no longer fits its humans: one now arming or in a
   * fight, with a bot nearby, has no urgent support, or one dealt urgent support no longer needs
   * it.
   */
  static boolean stale(
      Blackboard board, TeamBrain.TeamSituation situation, List<CombatantView> bots) {
    var humans = situation.humans(board.team());
    if (humans.isEmpty() || bots.size() < 2) return false;
    var snapshot = situation.snapshot();
    var served = served(board.plan());
    for (var human : humans) {
      var urgent = need(board, snapshot, human).urgent();
      var nearby = bots.stream().anyMatch(bot -> bot.pos().distance(human.pos()) <= NEARBY);
      var dealt = served.getOrDefault(human.id(), false);
      if (urgent && nearby && !dealt) return true;
      if (!urgent && dealt) return true;
    }
    return false;
  }
}
