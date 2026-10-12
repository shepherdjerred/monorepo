package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.BotActions;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.RwfBotsConfig;
import com.shepherdjerred.thestorm.rwfbots.app.LobbyLoop;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkLoop;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.KitPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyLife;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyScene;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbySteering;
import com.shepherdjerred.thestorm.rwfbots.domain.lobby.LobbyTemperament;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * The bots before the match, every tick while rwf's lobby is open: each bot picks the first kit of
 * its {@link KitPlan} as it walks in and later switches through the same {@link BotActions#pickKit}
 * path humans use, the last switch always to its drafted kit; a couple of times a second the lobby
 * is handed to the {@link LobbyLoop} to plan, and every tick each bot follows its newest plan with
 * the body commands match play uses. When the match goes live it all stops and the match's think
 * loop takes over. Main thread only.
 */
public final class LobbyTicker {

  /** Plans are refreshed this often: twice a second. */
  static final int PLAN_EVERY_TICKS = 10;

  /** A bot's last kit switch lands at least this long before the match starts. */
  static final Duration SWITCH_MARGIN = Duration.ofSeconds(3);

  private final Parts parts;
  private final Map<UUID, Visitor> visitors = new HashMap<>();
  private final IdMap noIds = new IdMap();
  private @Nullable UUID matchId;

  /**
   * What the ticker works with.
   *
   * @param roster the bots
   * @param loop plans off the main thread
   * @param nav the lobby's baked navigation
   * @param driver applies commands to bodies
   * @param actions the rules' actions, for kit picks
   * @param config the module settings: the kits bots may pick
   * @param time the clock
   * @param logger the module logger
   */
  public record Parts(
      Roster roster,
      LobbyLoop loop,
      NavArtifact nav,
      BodyDriver driver,
      BotActions actions,
      RwfBotsConfig config,
      InstantSource time,
      ComponentLogger logger) {}

  /** A bot in the lobby: when it walked in, its kit plan, and how far along both it is. */
  private static final class Visitor {
    final BotBody bot;
    final Instant arrived;
    final KitPlan kits;
    final LobbyTemperament temperament;
    int nextSwitch;
    LobbySteering.State steering = LobbySteering.State.FRESH;

    Visitor(BotBody bot, Instant arrived, KitPlan kits, LobbyTemperament temperament) {
      this.bot = bot;
      this.arrived = arrived;
      this.kits = kits;
      this.temperament = temperament;
    }

    Optional<KitPlan.Switch> pending() {
      return nextSwitch < kits.switches().size()
          ? Optional.of(kits.switches().get(nextSwitch))
          : Optional.empty();
    }
  }

  public LobbyTicker(Parts parts) {
    this.parts = parts;
  }

  /**
   * {@code bot} walked into the lobby of {@code state}'s match: plans its kits within the time left
   * before the start and returns the kit it picks now.
   */
  public String arrived(BotBody bot, MatchState state) {
    follow(state.matchId());
    var now = parts.time().instant();
    var window =
        state
            .startsAt()
            .map(start -> Duration.between(now, start).minus(SWITCH_MARGIN))
            .filter(left -> !left.isNegative())
            .orElse(Duration.ZERO);
    var drafted = RwfBotsConfig.kitId(bot.drafted().kit());
    var temperament = LobbyTemperament.of(bot.drafted().personality());
    var random =
        new SplittableRandom(
            ThinkLoop.seed(MatchSession.seedOf(state.matchId()), bot.uuid().hashCode(), 0));
    var plan =
        KitPlan.plan(
            new KitPlan.Choice(drafted, parts.config().draft().kits()),
            temperament,
            window,
            random);
    visitors.put(bot.uuid(), new Visitor(bot, now, plan, temperament));
    return plan.first();
  }

  /** The kit switches {@code bot} still has to make, for diagnostics. */
  public List<KitPlan.Switch> pendingSwitches(UUID bot) {
    var visitor = visitors.get(bot);
    if (visitor == null) {
      return List.of();
    }
    return visitor.kits.switches().subList(visitor.nextSwitch, visitor.kits.switches().size());
  }

  /** One tick of the lobby, while {@code state} is before the start. */
  public void run(long tick, MatchState state) {
    follow(state.matchId());
    var now = parts.time().instant();
    var inLobby = new HashMap<UUID, Player>();
    for (var fighter : state.combatants()) {
      parts.roster().anyEntity(fighter.uuid()).ifPresent(e -> inLobby.put(fighter.uuid(), e));
    }
    visitors.keySet().removeIf(uuid -> !inLobby.containsKey(uuid));
    for (var visitor : visitors.values()) {
      switchKits(visitor, now);
    }
    if (tick % PLAN_EVERY_TICKS == 0) {
      parts.loop().publish(round(tick, state, inLobby));
    }
    var plans = parts.loop().plans();
    for (var visitor : visitors.values()) {
      var plan = plans.get(visitor.bot.uuid());
      var entity = inLobby.get(visitor.bot.uuid());
      if (plan == null || entity == null) {
        continue;
      }
      var person = plan.facing().map(inLobby::get).map(LobbyTicker::feet);
      var step = LobbySteering.tick(visitor.steering, plan, body(entity, person), tick);
      visitor.steering = step.state();
      parts.driver().apply(visitor.bot, step.commands(), noIds, tick);
    }
  }

  /** The lobby closed for this match: bots stop sneaking and the loop stops planning. */
  public void leave() {
    for (var visitor : visitors.values()) {
      if (visitor.steering.sneaking()) {
        parts.roster().bodies().sneak(visitor.bot.uuid(), false);
      }
    }
    visitors.clear();
    parts.loop().end();
    matchId = null;
  }

  private void follow(UUID match) {
    if (!match.equals(matchId)) {
      visitors.clear();
      matchId = match;
      parts.loop().begin(MatchSession.seedOf(match), parts.nav());
    }
  }

  private void switchKits(Visitor visitor, Instant now) {
    var due = visitor.pending();
    if (due.isEmpty() || now.isBefore(visitor.arrived.plus(due.orElseThrow().after()))) {
      return;
    }
    visitor.nextSwitch++;
    var kit = due.orElseThrow().kit();
    parts
        .actions()
        .pickKit(visitor.bot.uuid(), kit)
        .ifPresent(
            refusal -> {
              visitor.bot.refused(refusal);
              parts
                  .logger()
                  .warn(
                      "rwfbots: {} could not switch to kit {}: {}",
                      visitor.bot.name(),
                      kit,
                      refusal);
            });
  }

  private LobbyLoop.Round round(long tick, MatchState state, Map<UUID, Player> inLobby) {
    var people = new ArrayList<LobbyScene.Person>();
    for (var fighter : state.combatants()) {
      var entity = inLobby.get(fighter.uuid());
      if (entity != null) {
        people.add(new LobbyScene.Person(fighter.uuid(), fighter.personalityId(), feet(entity)));
      }
    }
    var bots = new ArrayList<LobbyLife.Self>();
    for (var visitor : visitors.values()) {
      var personality = visitor.bot.drafted().personality();
      bots.add(
          new LobbyLife.Self(
              visitor.bot.uuid(),
              personality.id(),
              visitor.temperament,
              personality.rivals(),
              visitor.pending().map(KitPlan.Switch::kit)));
    }
    return new LobbyLoop.Round(new LobbyScene(tick, people), bots);
  }

  private static Vec3 feet(Player entity) {
    var at = Places.at(entity);
    return new Vec3(at.getX(), at.getY(), at.getZ());
  }

  private static LobbySteering.Body body(Player entity, Optional<Vec3> person) {
    var at = Places.at(entity);
    return new LobbySteering.Body(
        feet(entity),
        SnapshotCapture.onGround(entity),
        new Facing(at.getYaw(), Math.clamp(at.getPitch(), -90, 90)),
        person);
  }
}
