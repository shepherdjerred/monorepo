package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.BotActions;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwf.app.view.Transition;
import com.shepherdjerred.thestorm.rwfbots.adapter.record.GzipTraceFiles;
import com.shepherdjerred.thestorm.rwfbots.app.BotProfile;
import com.shepherdjerred.thestorm.rwfbots.app.MatchSettlement;
import com.shepherdjerred.thestorm.rwfbots.app.NavCatalog;
import com.shepherdjerred.thestorm.rwfbots.app.PersonalityStats;
import com.shepherdjerred.thestorm.rwfbots.app.PersonalityStatsStore;
import com.shepherdjerred.thestorm.rwfbots.app.StatsCache;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkLoop;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Location;
import org.bukkit.World;
import org.jspecify.annotations.Nullable;

/**
 * Listens to rwf's match transitions and keeps the bots in step: confirms the map's nav artifact
 * when a map is chosen, picks each bot's kit when it joins, starts the think loop with every bot's
 * profile when the match goes live, bumps a bot's life epoch when it dies, is teleported, spectates
 * or rewinds, tallies kills, deaths, plants and defuses, and settles the personality records and
 * the trace file when the match ends. Main thread only.
 */
public final class MatchBridge implements Consumer<MatchNotification> {

  private final Parts parts;
  private MatchEvents.@Nullable Subscription subscription;
  private boolean live;

  /**
   * What the bridge works with.
   *
   * @param roster the bots
   * @param loop the think loop
   * @param actions the rules' actions, for kit picks
   * @param nav the nav artifacts
   * @param stats the cached records and their store
   * @param store where records are written
   * @param traces the trace files, when enabled
   * @param world the match world
   * @param stimuli where fuse clicks are reported
   * @param time the clock
   * @param logger the module logger
   * @param lobby plans each bot's kits in the lobby
   */
  public record Parts(
      Roster roster,
      ThinkLoop loop,
      BotActions actions,
      NavCatalog nav,
      StatsCache stats,
      PersonalityStatsStore store,
      Optional<GzipTraceFiles> traces,
      World world,
      StimulusCollector stimuli,
      InstantSource time,
      ComponentLogger logger,
      LobbyTicker lobby) {}

  public MatchBridge(Parts parts) {
    this.parts = parts;
  }

  public void subscribe(MatchEvents events) {
    subscription = events.subscribe(this);
  }

  public void close() {
    var current = subscription;
    if (current != null) {
      current.close();
      subscription = null;
    }
  }

  @Override
  public void accept(MatchNotification notification) {
    var transition = Transition.of(notification);
    change(transition.change(), transition.after());
    for (var effect : transition.effects()) {
      effect(effect);
    }
    phase(transition.after());
  }

  private void change(Transition.Change change, MatchState after) {
    switch (change) {
      case Transition.Change.MapChosen chosen ->
          parts
              .nav()
              .confirm(chosen.mapId(), chosen.blocksSha256())
              .ifPresent(
                  problem ->
                      parts
                          .logger()
                          .error("rwfbots: map {} runs humans-only: {}", chosen.mapId(), problem));
      case Transition.Change.Joined joined -> joined(joined.uuid(), after);
      case Transition.Change.Died died -> died(died);
      case Transition.Change.BombClicked click -> clicked(click, after);
      case Transition.Change.Left left ->
          parts
              .roster()
              .bot(left.uuid())
              .flatMap(BotBody::profile)
              .ifPresent(p -> parts.loop().unregister(p.id()));
      case Transition.Change.KitPicked _,
          Transition.Change.Ticked _,
          Transition.Change.ForceStarted _,
          Transition.Change.Stopped _,
          Transition.Change.Reset _ -> {}
    }
  }

  /** A bot walked into the lobby: it picks the first kit of its lobby plan. */
  private void joined(UUID uuid, MatchState after) {
    parts
        .roster()
        .bot(uuid)
        .ifPresent(
            bot -> {
              var kit =
                  parts.roster().harness().active(after.matchId())
                      ? "trooper"
                      : parts.lobby().arrived(bot, after);
              parts
                  .actions()
                  .pickKit(uuid, kit)
                  .ifPresent(
                      refusal ->
                          parts
                              .logger()
                              .warn(
                                  "rwfbots: {} could not pick kit {}: {}",
                                  bot.name(),
                                  kit,
                                  refusal));
            });
  }

  /**
   * The rules killed {@code victim} (a bomb): no world death event will count it, so the death is
   * tallied here.
   */
  private void killed(UUID victim) {
    var bot = parts.roster().bot(victim);
    if (bot.isEmpty()) {
      bump(victim);
      return;
    }
    bot.orElseThrow().tally(bot.orElseThrow().tally().death());
    newLife(bot.orElseThrow());
  }

  private void died(Transition.Change.Died died) {
    parts
        .roster()
        .bot(died.victim())
        .ifPresent(
            bot -> {
              bot.tally(bot.tally().death());
              newLife(bot);
            });
    died.killer()
        .flatMap(parts.roster()::bot)
        .ifPresent(killer -> killer.tally(killer.tally().kill()));
  }

  private void clicked(Transition.Change.BombClicked click, MatchState after) {
    after
        .bomb(click.bombId())
        .ifPresent(
            bomb ->
                parts
                    .stimuli()
                    .fuseClicked(
                        click.uuid(),
                        new Location(
                            parts.world(), bomb.x() + 0.5, bomb.y() + 0.5, bomb.z() + 0.5)));
  }

  private void effect(Transition.Effect effect) {
    switch (effect) {
      case Transition.Effect.Teleported teleported -> bump(teleported.uuid());
      case Transition.Effect.Spectating spectating -> bump(spectating.uuid());
      case Transition.Effect.Restored restored ->
          parts
              .roster()
              .bot(restored.uuid())
              .flatMap(BotBody::profile)
              .ifPresent(profile -> parts.loop().unregister(profile.id()));
      case Transition.Effect.StatRecorded stat -> stat(stat);
      case Transition.Effect.Killed killed -> killed.victims().forEach(this::killed);
      case Transition.Effect.Equipped _ -> {}
    }
  }

  private void stat(Transition.Effect.StatRecorded stat) {
    parts
        .roster()
        .bot(stat.uuid())
        .ifPresent(
            bot -> {
              switch (stat.stat()) {
                case "Armed" -> bot.tally(bot.tally().plant());
                case "Defused" -> bot.tally(bot.tally().defuse());
                default -> {}
              }
            });
  }

  private void bump(UUID uuid) {
    parts.roster().bot(uuid).ifPresent(this::newLife);
  }

  /** The bot's body is somewhere new: the think loop and the reflex start a new life. */
  public void newLife(BotBody bot) {
    bot.profile().ifPresent(profile -> parts.loop().bumpEpoch(profile.id()));
    var facing =
        parts
            .roster()
            .bodies()
            .entity(bot.uuid())
            .map(Places::at)
            .map(at -> new Facing(at.getYaw(), Math.clamp(at.getPitch(), -90, 90)))
            .orElse(Facing.SOUTH);
    bot.newLife(facing);
  }

  /** A bot's Rewind landed: its body moved without a match effect. */
  public void rewound(BotBody bot) {
    newLife(bot);
  }

  /** The phase moved: start the match's session when it goes live, settle it when it ends. */
  private void phase(MatchState after) {
    var nowLive = after.phase() == MatchState.Phase.LIVE;
    if (nowLive && !live) {
      live = true;
      wentLive(after);
    } else if (!nowLive && live) {
      live = false;
      ended(after);
    }
  }

  private void wentLive(MatchState after) {
    var mapId = after.mapId().orElseThrow(() -> new IllegalStateException("live without a map"));
    var ours = parts.roster().live();
    if (ours.isEmpty()) {
      return;
    }
    var nav = parts.nav().forMap(mapId);
    if (nav.isEmpty()) {
      throw new IllegalStateException("bots were drafted for " + mapId + " without a nav artifact");
    }
    var seed =
        parts
            .roster()
            .harness()
            .seed(after.matchId())
            .orElseGet(() -> MatchSession.seedOf(after.matchId()));
    var ids = new IdMap();
    var capture = new SnapshotCapture(ids, parts.roster()::anyEntity, parts.stimuli());
    parts
        .roster()
        .session(new MatchSession(after.matchId(), seed, nav.orElseThrow(), ids, capture));
    parts.loop().beginMatch(seed, nav.orElseThrow());
    var slot = 0;
    for (var bot : ours) {
      var fighter = after.combatant(bot.uuid());
      if (fighter.isEmpty() || fighter.orElseThrow().team().isEmpty()) {
        continue;
      }
      var profile = profile(bot, fighter.orElseThrow(), ids, slot++);
      bot.profile(profile, ThinkLoop.seed(seed, profile.id().value(), 0));
      parts.loop().register(profile);
    }
    parts
        .traces()
        .ifPresent(traces -> logFailure(traces.begin(after.matchId()), "open the trace file"));
    parts.logger().info("rwfbots: {} bots thinking in match {}", ours.size(), after.matchId());
  }

  private static BotProfile profile(BotBody bot, MatchState.Fighter fighter, IdMap ids, int slot) {
    var kitId = fighter.kit().orElseThrow(() -> new IllegalStateException("live without a kit"));
    var kit = Kit.valueOf(kitId.toUpperCase(Locale.ROOT));
    return new BotProfile(
        ids.combatant(bot.uuid()),
        slot,
        bot.personalityId(),
        IdMap.team(fighter.team().orElseThrow()),
        kit,
        bot.drafted().levers(),
        bot.drafted().personality().style(),
        bot.drafted().personality().roles(),
        bot.drafted().personality().archetype(),
        bot.drafted().personality().quirks());
  }

  private void ended(MatchState after) {
    parts.loop().endMatch();
    parts.roster().session(null);
    parts.traces().ifPresent(traces -> logFailure(traces.end(), "close the trace file"));
    if (after.phase() == MatchState.Phase.ENDED
        && !parts.roster().harness().active(after.matchId())) {
      settle(after);
    }
  }

  /** Every team's members through one rating update; stopped matches rate nobody. */
  private void settle(MatchState after) {
    var now = parts.time().instant();
    var teams = new LinkedHashMap<TeamId, List<MatchSettlement.Member>>();
    var records = new java.util.HashMap<String, PersonalityStats>();
    for (var fighter : after.combatants()) {
      var team = fighter.team();
      if (team.isEmpty()) {
        continue;
      }
      var members = teams.computeIfAbsent(IdMap.team(team.orElseThrow()), t -> new ArrayList<>());
      var bot = parts.roster().bot(fighter.uuid());
      if (bot.isEmpty()) {
        members.add(
            new MatchSettlement.Member(
                Optional.empty(), Rating.DEFAULT, PersonalityStats.Tally.NONE));
        continue;
      }
      var body = bot.orElseThrow();
      var current = parts.stats().orFresh(body.personalityId(), body.drafted().rating(), now);
      records.put(body.personalityId(), current);
      members.add(
          new MatchSettlement.Member(
              Optional.of(body.personalityId()), current.rating(), body.tally()));
    }
    if (records.isEmpty() || teams.size() < 2) {
      return;
    }
    var updated = MatchSettlement.settle(teams, after.winner().map(IdMap::team), records, now);
    parts.stats().put(updated);
    logFailure(parts.store().save(updated), "save personality records");
    parts
        .logger()
        .info("rwfbots: rated {} personalities after match {}", updated.size(), after.matchId());
  }

  private void logFailure(java.util.concurrent.CompletableFuture<?> future, String what) {
    var _ =
        future.whenComplete(
            (value, failure) -> {
              if (failure != null) {
                parts.logger().error("rwfbots: could not {}", what, failure);
              }
            });
  }
}
