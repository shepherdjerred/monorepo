package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * What a team's bots call out about the round in team chat. In production every one of 651 team
 * lines was {@code Enemy near x, z!}: nothing said a fuse was going in, the own bomb was lit, a bot
 * was coming or a human had an enemy on them. One instance per team watches the team's bombs,
 * decisions and support slots and calls each objective moment once, as it begins:
 *
 * <ul>
 *   <li>the enemy arming the own bomb, the own bomb lit (retake), and it burning low with nobody on
 *       the fuse;
 *   <li>a bot making for the own fuse or an enemy bomb (defusing, planting); a teammate calls it
 *       when the worker is already at the fuse;
 *   <li>a bot sent to cover an arming human, or to help one in a fight;
 *   <li>a bot stuck in a losing fight.
 * </ul>
 *
 * <p>Each moment has a key and is called at most once per {@link #REPEAT_TICKS}; the chat layer
 * further drops a call a teammate just made and keeps to its rate limits. Enemy sightings are
 * called through {@link #enemy}, which addresses a human the enemy is near. Not thread-safe.
 */
public final class TeamCallouts {

  /** The same moment is called at most once in this many ticks. */
  public static final long REPEAT_TICKS = 400;

  /** A bot this close to its target bomb calls its own plant or defuse. */
  static final double CALL_RANGE = 24;

  /** A bot this close to a fuse is working it, too busy to type. */
  static final double AT_FUSE = 4;

  /** A fuse with this little time left and no hands on it needs a defuse now, in ticks. */
  public static final long LOW_FUSE_TICKS = 300;

  /** A bot this low on health, stuck in a fight, needs help. */
  static final double LOW_HEALTH = 10;

  /** Two enemies seen this close to a bot stuck in a fight mean it is outnumbered. */
  static final double OUTNUMBERED = 12;

  /** An enemy this close to a human is called to that human. */
  public static final double NEAR_HUMAN = 16;

  /** How far ahead along a human's path an enemy counts as where they are heading, in ticks. */
  static final long HEADING_TICKS = 40;

  private final Map<String, Long> said = new HashMap<>();
  private final Set<BombId> lit = new HashSet<>();

  /**
   * One team at one tick.
   *
   * @param team whose calls
   * @param snapshot the world
   * @param board the team's board
   * @param decisions the living bots' latest decisions
   * @param bots the team's living bots
   * @param humans the team's living humans
   * @param places how players name the map's places
   */
  public record Scene(
      TeamId team,
      WorldSnapshot snapshot,
      Blackboard board,
      Map<CombatantId, Decision> decisions,
      List<CombatantView> bots,
      List<CombatantView> humans,
      Places places) {

    public Scene {
      decisions = Map.copyOf(decisions);
      bots = List.copyOf(bots);
      humans = List.copyOf(humans);
    }

    long tick() {
      return snapshot.tick();
    }
  }

  /** The moments of {@code scene} not called lately, most urgent first. */
  public List<Callout> observe(Scene scene) {
    var tick = scene.tick();
    said.values().removeIf(at -> tick - at >= REPEAT_TICKS);
    var out = new ArrayList<Callout>();
    if (scene.bots().isEmpty()) return out;
    for (var bomb : scene.snapshot().bombsOf(scene.team())) ownBomb(scene, bomb, out);
    work(scene, out);
    support(scene, out);
    trouble(scene, out);
    out.sort(Comparator.comparing(Callout::kind));
    return out;
  }

  private void ownBomb(Scene scene, BombView bomb, List<Callout> out) {
    var place = scene.places().name(bomb.pos());
    if (bomb.state() instanceof BombState.Arming(var by, var _, var _)
        && !by.equals(scene.team())) {
      call(scene, "enemy-planting:" + bomb.id().value(), out, Callout.Kind.ENEMY_PLANTING)
          .accept(nearest(scene, bomb.pos(), Optional.empty()), bomb.pos(), place);
    }
    if (!bomb.state().isLit()) {
      lit.remove(bomb.id());
      return;
    }
    if (lit.add(bomb.id())) {
      var retaker =
          scene.board().plan().assignment().entrySet().stream()
              .filter(
                  entry ->
                      scene
                          .board()
                          .plan()
                          .slot(entry.getValue())
                          .map(slot -> slot.role() == Role.RETAKE)
                          .orElse(false))
              .map(Map.Entry::getKey)
              .flatMap(id -> scene.bots().stream().filter(bot -> bot.id().equals(id)))
              .filter(bot -> !busy(scene, bot))
              .min(byDistance(bomb.pos()));
      call(scene, "retaking:" + bomb.id().value(), out, Callout.Kind.RETAKING)
          .accept(
              retaker.or(() -> nearest(scene, bomb.pos(), Optional.empty())), bomb.pos(), place);
    }
    if (bomb.state() instanceof BombState.Armed(var remaining)
        && remaining <= LOW_FUSE_TICKS
        && scene.decisions().values().stream()
            .noneMatch(
                decision ->
                    decision.option() == Option.DEFUSE
                        && decision.bomb().filter(bomb.id()::equals).isPresent())) {
      call(scene, "need-defuse:" + bomb.id().value(), out, Callout.Kind.NEED_DEFUSE)
          .accept(nearest(scene, bomb.pos(), Optional.empty()), bomb.pos(), place);
    }
  }

  /** A bot making for a fuse: its own call on the way, a teammate's once it is there. */
  private void work(Scene scene, List<Callout> out) {
    for (var bot : scene.bots()) {
      var decision = Optional.ofNullable(scene.decisions().get(bot.id()));
      var kind = decision.flatMap(TeamCallouts::workKind);
      var target =
          decision
              .flatMap(Decision::bomb)
              .flatMap(scene.snapshot()::bomb)
              .filter(bomb -> bomb.pos().distance(bot.pos()) <= CALL_RANGE);
      if (kind.isEmpty() || target.isEmpty()) continue;
      work(scene, bot, kind.orElseThrow(), target.orElseThrow()).ifPresent(out::add);
    }
  }

  /** The call for a bot whose decision works a fuse: arming or defusing. */
  private static Optional<Callout.Kind> workKind(Decision decision) {
    return switch (decision.option()) {
      case ARM -> Optional.of(Callout.Kind.PLANTING);
      case DEFUSE -> Optional.of(Callout.Kind.DEFUSING);
      default -> Optional.empty();
    };
  }

  /**
   * {@code bot}'s call that it works {@code target}, by itself on the way and by the teammate
   * nearest it once its hands are on the fuse; empty when made lately or nobody is free to type.
   */
  private Optional<Callout> work(
      Scene scene, CombatantView bot, Callout.Kind kind, BombView target) {
    var key = kind.name() + ":" + target.id().value();
    if (said.containsKey(key)) return Optional.empty();
    var free = !busy(scene, bot);
    var speaker =
        free
            ? Optional.of(bot)
            : nearest(scene, bot.pos(), Optional.of(bot.id()))
                .filter(teammate -> teammate.pos().distance(bot.pos()) <= CALL_RANGE);
    if (speaker.isEmpty()) return Optional.empty();
    said.put(key, scene.tick());
    return Optional.of(
        new Callout(
            kind,
            speaker.orElseThrow().id(),
            scene.team(),
            target.pos(),
            scene.places().name(target.pos()),
            free ? Optional.empty() : Optional.of(bot.id()),
            Optional.empty(),
            scene.tick()));
  }

  /** A bot dealt urgent support for a human tells them it is coming. */
  private void support(Scene scene, List<Callout> out) {
    var plan = scene.board().plan();
    for (var human : scene.humans()) {
      var need = HumanSupport.need(scene.board(), scene.snapshot(), human);
      if (!need.urgent()) continue;
      var helper =
          scene.bots().stream()
              .filter(
                  bot ->
                      plan.slotOf(bot.id())
                          .flatMap(Slot::buddy)
                          .filter(human.id()::equals)
                          .isPresent())
              .filter(bot -> !busy(scene, bot))
              .min(byDistance(human.pos()));
      if (helper.isEmpty()) continue;
      var kind = need == HumanSupport.Need.ARMING ? Callout.Kind.COVERING : Callout.Kind.HELPING;
      var key = kind.name() + ":" + human.id().value();
      if (said.containsKey(key)) continue;
      said.put(key, scene.tick());
      out.add(
          new Callout(
              kind,
              helper.orElseThrow().id(),
              scene.team(),
              human.pos(),
              scene.places().name(human.pos()),
              Optional.of(human.id()),
              Optional.empty(),
              scene.tick()));
    }
  }

  /** A bot stuck in a fight it is losing: low on health, or two enemies on it. */
  private void trouble(Scene scene, List<Callout> out) {
    var tick = scene.tick();
    for (var bot : scene.bots()) {
      if (!scene.board().pinned(bot.id(), tick)) continue;
      var near =
          scene.board().visibleSightings(tick).stream()
              .filter(sighting -> tick - sighting.seenTick() <= HumanSupport.ENGAGED_RECENT)
              .filter(sighting -> sighting.pos().distance(bot.pos()) <= OUTNUMBERED)
              .count();
      if (bot.effectiveHealth() > LOW_HEALTH && near < 2) continue;
      call(scene, "help:" + bot.id().value(), out, Callout.Kind.NEED_HELP)
          .accept(Optional.of(bot), bot.pos(), scene.places().name(bot.pos()));
    }
  }

  /** Adds a call by the speaker it is given, once per key and {@link #REPEAT_TICKS}. */
  private Caller call(Scene scene, String key, List<Callout> out, Callout.Kind kind) {
    return (speaker, pos, place) -> {
      if (speaker.isEmpty() || said.containsKey(key)) return;
      said.put(key, scene.tick());
      out.add(
          new Callout(
              kind,
              speaker.orElseThrow().id(),
              scene.team(),
              pos,
              place,
              Optional.empty(),
              Optional.empty(),
              scene.tick()));
    };
  }

  @FunctionalInterface
  private interface Caller {
    void accept(Optional<CombatantView> speaker, Vec3 pos, String place);
  }

  /** The living bot nearest {@code pos} that is not working a fuse, other than {@code except}. */
  private static Optional<CombatantView> nearest(
      Scene scene, Vec3 pos, Optional<CombatantId> except) {
    return scene.bots().stream()
        .filter(bot -> except.filter(bot.id()::equals).isEmpty())
        .filter(bot -> !busy(scene, bot))
        .min(byDistance(pos));
  }

  private static Comparator<CombatantView> byDistance(Vec3 pos) {
    return Comparator.comparingDouble((CombatantView bot) -> bot.pos().distance(pos))
        .thenComparing(CombatantView::id);
  }

  /** Whether {@code bot} stands at a fuse it works: its hands are on the bomb, not the keyboard. */
  static boolean busy(Scene scene, CombatantView bot) {
    var decision = scene.decisions().get(bot.id());
    if (decision == null) return false;
    var working =
        switch (decision.option()) {
          case ARM, HELP_ARM, DEFUSE -> true;
          default -> false;
        };
    return working
        && decision
            .bomb()
            .flatMap(scene.snapshot()::bomb)
            .filter(bomb -> bomb.pos().distance(bot.pos()) <= AT_FUSE)
            .isPresent();
  }

  /**
   * How useful a sighting at {@code pos} is to {@code humans}: its distance from the nearest of
   * them, where they stand or where they are heading. Smaller is more useful; without humans every
   * sighting is equally useful.
   */
  public static double usefulness(Vec3 pos, List<CombatantView> humans) {
    var best = Double.POSITIVE_INFINITY;
    for (var human : humans) {
      var heading = human.pos().plus(human.vel().scale(HEADING_TICKS));
      best = Math.min(best, Math.min(pos.distance(human.pos()), pos.distance(heading)));
    }
    return humans.isEmpty() ? 0 : best;
  }

  /**
   * The call for an enemy {@code reporter} saw at {@code sighting}: addressed to the human it is
   * nearest, with where it is from them, when one is within {@link #NEAR_HUMAN}.
   */
  public static Callout enemy(
      SharedSighting sighting, TeamId team, List<CombatantView> humans, Places places) {
    var pos = sighting.pos();
    var human =
        humans.stream().filter(view -> view.pos().distance(pos) <= NEAR_HUMAN).min(byDistance(pos));
    return new Callout(
        Callout.Kind.ENEMY,
        sighting.reporter(),
        team,
        pos,
        places.name(pos),
        human.map(CombatantView::id),
        human.map(view -> bearing(view, pos)),
        sighting.seenTick());
  }

  /** Where {@code pos} lies from where {@code human} looks: ahead, behind, left or right. */
  public static String bearing(CombatantView human, Vec3 pos) {
    var toward = pos.minus(human.pos()).horizontal();
    var facing = human.facing().direction().horizontal();
    if (toward.isZero() || facing.isZero()) return "on you";
    var look = facing.normalized();
    var dir = toward.normalized();
    // Minecraft's x runs east and z south, so a player's right hand is at look x up.
    var right = look.x() * dir.z() - look.z() * dir.x();
    var angle = Math.toDegrees(Math.atan2(right, look.dot(dir)));
    if (Math.abs(angle) <= 45) return "ahead of you";
    if (Math.abs(angle) >= 135) return "behind you";
    return angle > 0 ? "on your right" : "on your left";
  }
}
