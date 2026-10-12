// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/LobbyManager.java,
// GameManager.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java,
// onGameStart/onPoison); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageLog;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonDamage;
import com.shepherdjerred.thestorm.rwf.domain.reward.Participation;
import com.shepherdjerred.thestorm.rwf.domain.reward.RewardEligibility;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;

/**
 * The lobby, the countdown and its map vote, preparing and previewing the map, the freeze, going
 * live, the poison, the end and the reset.
 */
final class Flow {

  /** World time for a night match. */
  static final long NIGHT_TICKS = 15000;

  /** One match in this many is played at night. */
  static final int NIGHT_ODDS = 5;

  /** Who a reset lets go of. */
  enum Release {
    /** The match ended on its own: humans stay in for the next match, bots go. */
    CARRY,
    /** Stopped, aborted or disabled: everyone goes. */
    RELEASE,
  }

  private Flow() {}

  /** Whether the match with {@code seed} is played at night. */
  static boolean night(long seed) {
    return new SplittableRandom(seed).nextInt(NIGHT_ODDS) == 0;
  }

  static long startingWorldTime(long seed) {
    return night(seed) ? NIGHT_TICKS : 0;
  }

  static void tick(Draft draft, MatchEvent.Tick tick) {
    var now = tick.now();
    switch (draft.phase) {
      case Phase.Lobby lobby -> lobbyTick(draft, lobby, now);
      case Phase.Countdown countdown -> countdownTick(draft, countdown, now);
      case Phase.Preparing preparing -> {
        if (draft.members().isEmpty()) {
          draft.phase = new Phase.Lobby(Optional.empty(), preparing.ballot());
        }
      }
      case Phase.Preview preview -> {
        if (draft.members().isEmpty()) {
          abandon(draft);
        } else if (!now.isBefore(preview.until())) {
          freeze(draft, now);
        }
      }
      case Phase.Freeze freeze -> {
        if (!now.isBefore(freeze.until())) {
          goLive(draft, now);
        }
      }
      case Phase.Live _ -> {
        Bombs.tick(draft, now, tick.vitals());
        if (draft.phase instanceof Phase.Live still) {
          poisonTick(draft, still, tick);
        }
        Standings.check(draft, now);
      }
      case Phase.Ended ended -> {
        if (!now.isBefore(ended.at().plus(draft.settings.endLinger()))) {
          reset(draft, naturalRelease(draft));
        }
      }
      case Phase.Resetting _ -> {}
    }
  }

  /** A match that ended on its own carries its humans over, when carry-over is on. */
  private static Release naturalRelease(Draft draft) {
    return draft.settings.carryOver() ? Release.CARRY : Release.RELEASE;
  }

  /** Everyone left during the preview: the lobby waits again, with a fresh vote. */
  private static void abandon(Draft draft) {
    draft.map = Optional.empty();
    draft.phase = Phase.Lobby.EMPTY;
    draft.effect(new MatchEffect.NeedBallot());
  }

  private static void lobbyTick(Draft draft, Phase.Lobby lobby, Instant now) {
    if (draft.members().isEmpty()) {
      draft.phase = new Phase.Lobby(Optional.empty(), lobby.ballot());
      return;
    }
    var waitingSince = lobby.waitingSince().orElse(now);
    draft.phase = new Phase.Lobby(Optional.of(waitingSince), lobby.ballot());
    if (lobby.ballot().opened() && enoughPlayers(draft, waitingSince, now)) {
      var seconds = draft.settings.countdown().toSeconds();
      draft.phase =
          new Phase.Countdown(
              now.plus(draft.settings.countdown()), waitingSince, (int) seconds, lobby.ballot());
      draft.announce(Notice.of(NoticeKind.COUNTDOWN, "seconds", seconds));
      draft.sound(draft.ids(), SoundCue.COUNTDOWN);
      closeVoteIfDue(draft, now);
    } else if (lobby.ballot().opened()
        && lobby.ballot().chosen().isEmpty()
        && draft.settings.requiredPlayers(Duration.between(waitingSince, now))
            <= draft.settings.absoluteMinPlayers()) {
      // The requirement has relaxed as far as it goes and the lobby is still short: the vote
      // closes now, so the chosen map loads and bots (where there are any) can be drafted to
      // make up the numbers. Waiting for the countdown to close it would wait forever.
      Voting.close(draft);
    }
  }

  private static boolean enoughPlayers(Draft draft, Instant waitingSince, Instant now) {
    var required = draft.settings.requiredPlayers(Duration.between(waitingSince, now));
    return draft.members().size() >= required;
  }

  private static void countdownTick(Draft draft, Phase.Countdown countdown, Instant now) {
    if (!countdown.ballot().opened() || !enoughPlayers(draft, countdown.waitingSince(), now)) {
      draft.phase = new Phase.Lobby(Optional.of(countdown.waitingSince()), countdown.ballot());
      draft.announce(Notice.of(NoticeKind.COUNTDOWN_CANCELLED));
      return;
    }
    closeVoteIfDue(draft, now);
    if (!now.isBefore(countdown.startsAt())) {
      afterCountdown(draft, now, false);
      return;
    }
    var remaining = (int) Math.ceil(Duration.between(now, countdown.startsAt()).toMillis() / 1000D);
    if (remaining != countdown.lastAnnounced() && announcedCountdown(remaining)) {
      draft.phase =
          new Phase.Countdown(
              countdown.startsAt(),
              countdown.waitingSince(),
              remaining,
              draft.ballot().orElseThrow());
      draft.announce(Notice.of(NoticeKind.COUNTDOWN, "seconds", remaining));
      draft.sound(draft.ids(), SoundCue.COUNTDOWN);
    }
  }

  /**
   * The vote closes {@code voteLead} before the countdown ends, so the map loads meanwhile; a
   * ballot with a single map has nothing to vote on and closes as the countdown starts.
   */
  private static void closeVoteIfDue(Draft draft, Instant now) {
    if (draft.phase instanceof Phase.Countdown countdown
        && (countdown.ballot().candidates().size() == 1
            || !now.isBefore(countdown.startsAt().minus(draft.settings.voteLead())))) {
      Voting.close(draft);
    }
  }

  /** Red Warfare announced 30, 15, 10 and every second from 5. */
  static boolean announcedCountdown(int seconds) {
    return seconds <= 5 || seconds == 10 || seconds == 15 || seconds == 30;
  }

  /**
   * The countdown is over (or an operator cut it short): the vote is closed, and the chosen map is
   * previewed once it is ready. An operator's start skips the preview and the freeze.
   */
  private static void afterCountdown(Draft draft, Instant now, boolean forced) {
    Voting.close(draft);
    var ballot = draft.ballot().orElseThrow();
    if (!chosenReady(draft, ballot)) {
      draft.phase = new Phase.Preparing(ballot, now, forced);
    } else if (forced) {
      deal(draft);
      goLive(draft, now);
    } else {
      preview(draft, now);
    }
  }

  private static boolean chosenReady(Draft draft, Ballot ballot) {
    var chosen = ballot.chosen();
    return draft.map.filter(map -> chosen.filter(map.id()::equals).isPresent()).isPresent();
  }

  /** The chosen map finished loading. */
  static Optional<MatchError> mapReady(Draft draft, MapDefinition map, Instant now) {
    var chosen = draft.ballot().flatMap(Ballot::chosen);
    if (chosen.filter(map.id()::equals).isEmpty()) {
      return Optional.of(MatchError.MAP_LOCKED);
    }
    draft.map = Optional.of(map);
    if (draft.phase instanceof Phase.Preparing preparing) {
      if (preparing.forced()) {
        deal(draft);
        goLive(draft, now);
      } else {
        preview(draft, now);
      }
    }
    return Optional.empty();
  }

  /** Members fly over the map; with no preview the teams are dealt at once. */
  private static void preview(Draft draft, Instant now) {
    if (draft.settings.previewLength().isZero()) {
      freeze(draft, now);
      return;
    }
    var map = draft.map();
    draft.phase = new Phase.Preview(now.plus(draft.settings.previewLength()));
    draft.effect(new MatchEffect.PreviewMap(draft.ids(), map.spectatorPoint()));
    draft.announce(
        Notice.of(NoticeKind.PREVIEW, Map.of("map", map.name(), "author", map.author())));
  }

  /** Teams, kits and spawns are dealt and everyone stands still; with no freeze it goes live. */
  private static void freeze(Draft draft, Instant now) {
    deal(draft);
    if (draft.settings.freezeLength().isZero()) {
      goLive(draft, now);
      return;
    }
    draft.phase = new Phase.Freeze(now.plus(draft.settings.freezeLength()));
    draft.effect(new MatchEffect.Freeze(draft.ids()));
    draft.announce(
        Notice.of(NoticeKind.FREEZE, "seconds", draft.settings.freezeLength().toSeconds()));
  }

  static Optional<MatchError> forceStart(Draft draft, Instant now) {
    return switch (draft.phase) {
      case Phase.Preview _ -> {
        deal(draft);
        goLive(draft, now);
        yield Optional.empty();
      }
      case Phase.Freeze _ -> {
        goLive(draft, now);
        yield Optional.empty();
      }
      case Phase.Lobby _, Phase.Countdown _ -> {
        if (draft.ballot().filter(Ballot::opened).isEmpty()) {
          yield Optional.of(MatchError.NO_MAP);
        }
        if (draft.members().size() < draft.settings.absoluteMinPlayers()) {
          yield Optional.of(MatchError.TOO_FEW_PLAYERS);
        }
        afterCountdown(draft, now, true);
        yield Optional.empty();
      }
      default -> Optional.of(MatchError.NOT_PRE_GAME);
    };
  }

  /** An operator moves the match on to its next step now. */
  static Optional<MatchError> skip(Draft draft, Instant now) {
    switch (draft.phase) {
      case Phase.Countdown countdown -> {
        draft.phase = new Phase.Countdown(now, countdown.waitingSince(), 0, countdown.ballot());
        afterCountdown(draft, now, false);
      }
      case Phase.Preview _ -> freeze(draft, now);
      case Phase.Freeze _ -> goLive(draft, now);
      case Phase.Ended _ -> reset(draft, naturalRelease(draft));
      default -> {
        return Optional.of(MatchError.NOTHING_TO_SKIP);
      }
    }
    return Optional.empty();
  }

  /** An operator gives the countdown, the preview or the freeze more time. */
  static Optional<MatchError> extend(Draft draft, Duration by) {
    Optional<Phase> later =
        switch (draft.phase) {
          case Phase.Countdown c ->
              Optional.of(
                  new Phase.Countdown(c.startsAt().plus(by), c.waitingSince(), 0, c.ballot()));
          case Phase.Preview preview -> Optional.of(new Phase.Preview(preview.until().plus(by)));
          case Phase.Freeze freeze -> Optional.of(new Phase.Freeze(freeze.until().plus(by)));
          default -> Optional.empty();
        };
    if (later.isEmpty()) {
      return Optional.of(MatchError.NOTHING_TO_SKIP);
    }
    draft.phase = later.orElseThrow();
    return Optional.empty();
  }

  /**
   * Teams are balanced, kits given and everyone sent to the spawn furthest from those already
   * placed, facing the spectator point.
   */
  private static void deal(Draft draft) {
    var map = draft.map();
    var seats =
        draft.members().stream()
            .map(
                m ->
                    new TeamBalancer.Seat(
                        m.id(), m.kit(), Optional.ofNullable(draft.pinned.get(m.id()))))
            .toList();
    var assignment =
        TeamBalancer.assign(
            seats, map.teamColors(), KitBook.SPREAD_EVENLY, new SplittableRandom(draft.seed));
    var placed = new ArrayList<Vec3>();
    var spectator = map.spectatorPoint().position();
    for (var member : draft.members()) {
      var team = Objects.requireNonNull(assignment.get(member.id()), "every member gets a team");
      var kitId = member.kit().orElseGet(KitBook.TROOPER::id);
      var kit =
          KitBook.byId(kitId)
              .orElseThrow(() -> new IllegalStateException("picked kit vanished: " + kitId));
      draft.put(member.fighting(team, kitId, kit.fuseBonus()));
      var spawn = StartSpawns.pick(map.team(team).orElseThrow().spawns(), placed, spectator);
      placed.add(spawn.position());
      draft.effect(new MatchEffect.Equip(member.id(), kitId));
      draft.effect(new MatchEffect.Teleport(member.id(), spawn));
      draft.tell(member.id(), Notice.of(NoticeKind.YOU_ARE_IN_TEAM, "team", team.displayName()));
    }
    draft.pinned.clear();
  }

  /** The match goes live: bombs placed, the clock started and everyone let go. */
  private static void goLive(Draft draft, Instant now) {
    var map = draft.map();
    if (draft.phase instanceof Phase.Freeze) {
      draft.effect(new MatchEffect.Unfreeze(draft.ids()));
    }
    draft.setBombs(map.bombs().stream().map(Bomb::at).toList());
    draft.effect(new MatchEffect.SetTime(startingWorldTime(draft.seed)));
    draft.announce(Notice.of(NoticeKind.GAME_BEGUN));
    draft.sound(draft.ids(), SoundCue.GAME_START);
    for (var team : map.teamColors()) {
      var count = draft.members().stream().filter(m -> m.onTeam(team)).count();
      draft.announce(
          Notice.of(
              NoticeKind.TEAM_SIZE,
              Map.of("team", team.displayName(), "count", String.valueOf(count))));
    }
    draft.phase =
        new Phase.Live(now, PoisonClock.start(now), now.plusSeconds(1), Set.of(), Set.of());
    Standings.check(draft, now);
  }

  private static void poisonTick(Draft draft, Phase.Live live, MatchEvent.Tick tick) {
    var now = tick.now();
    if (now.isBefore(live.nextPoisonSecond())) {
      return;
    }
    var step = live.poison().tick(now);
    var next = live.nextPoisonSecond();
    while (!next.isAfter(now)) {
      next = next.plusSeconds(1);
    }
    draft.phase =
        new Phase.Live(
            live.startedAt(), step.clock(), next, live.lastManAnnounced(), live.defeated());
    for (var notice : step.notices()) {
      switch (notice) {
        case WARNING -> draft.announce(Notice.of(NoticeKind.POISON_WARNING));
        case BEGUN -> {
          draft.announce(Notice.of(NoticeKind.POISON_BEGUN));
          draft.effect(
              new MatchEffect.StripFood(draft.alive().stream().map(Combatant::id).toList()));
        }
        case DAMAGE -> poisonDamage(draft, live.startedAt(), tick);
      }
    }
  }

  private static void poisonDamage(Draft draft, Instant startedAt, MatchEvent.Tick tick) {
    var extra = PoisonDamage.extra(startedAt, tick.now());
    var random = draft.random(tick.now());
    for (var team : draft.map().teamColors()) {
      var ownBombs = ownBombCenters(draft, team);
      for (var member : draft.aliveOn(team)) {
        var vitals = tick.vitals().get(member.id());
        if (vitals == null) {
          throw new IllegalStateException("tick carries no vitals for living " + member.id());
        }
        var target = new PoisonDamage.Target(vitals.position(), vitals.maxHealth());
        var amount = PoisonDamage.amount(target, ownBombs, extra, random);
        if (amount > 0) {
          draft.effect(new MatchEffect.PoisonDamage(member.id(), amount));
        }
      }
    }
  }

  /** The centres of {@code team}'s own remaining bombs; nukes do not count. */
  private static List<Vec3> ownBombCenters(Draft draft, TeamColor team) {
    var centers = new ArrayList<Vec3>();
    for (var bomb : draft.bombs()) {
      if (!bomb.isNuke() && !bomb.destroyed() && bomb.team().filter(t -> t == team).isPresent()) {
        centers.add(bomb.site().position().center());
      }
    }
    return centers;
  }

  /** The match is over. */
  static void end(Draft draft, Phase.Live live, Outcome outcome, Instant now) {
    draft.phase = new Phase.Ended(now, outcome);
    switch (outcome) {
      case Outcome.Winner(var team) ->
          draft.announce(Notice.of(NoticeKind.TEAM_WINS, "team", team.displayName()));
      case Outcome.Draw _ -> draft.announce(Notice.of(NoticeKind.DRAW));
      case Outcome.Stopped _ -> draft.announce(Notice.of(NoticeKind.STOPPED));
    }
    var roster = new ArrayList<Participation>();
    for (var member : draft.members()) {
      participation(member).ifPresent(roster::add);
    }
    for (var member : draft.departed()) {
      participation(member).ifPresent(roster::add);
    }
    var span = new RewardEligibility.Span(live.startedAt(), now);
    for (var award :
        RewardEligibility.settle(
            roster, outcome.winner(), span, draft.settings.minimumRewardLength())) {
      var id = award.to().id();
      draft.effect(new MatchEffect.Pay(id, award.credits(), award.reason().name()));
      // An AFK charge is told once settled, with what was actually taken (never more than held).
      if (award.reason() != RewardEligibility.Reason.AFK) {
        draft.tell(id, Notice.of(NoticeKind.CREDITS_GIVEN, "credits", award.credits()));
      }
    }
  }

  private static Optional<Participation> participation(Combatant member) {
    return member
        .team()
        .map(
            team ->
                new Participation(
                    member.id(),
                    team,
                    true,
                    member.diedAt(),
                    member.leftAt(),
                    member.forfeited(),
                    member.afk()));
  }

  static Optional<MatchError> stop(Draft draft) {
    if (draft.phase instanceof Phase.Resetting) {
      return Optional.of(MatchError.ALREADY_RESETTING);
    }
    if (draft.phase instanceof Phase.Live) {
      draft.announce(Notice.of(NoticeKind.STOPPED));
    }
    reset(draft, Release.RELEASE);
    return Optional.empty();
  }

  /**
   * The map is reverted. Members carried over go back to the lobby with their kits and their
   * belongings still held; everyone else is restored, each with exactly one {@code Restore}.
   */
  private static void reset(Draft draft, Release mode) {
    for (var member : draft.members()) {
      if (mode == Release.CARRY && !member.id().isBot() && !member.afk()) {
        draft.effect(
            new MatchEffect.ReturnToLobby(
                member.id(), member.kit().orElseGet(KitBook.TROOPER::id)));
      } else {
        draft.remove(member.id());
        draft.effect(new MatchEffect.Restore(member.id()));
      }
    }
    for (var bomb : draft.bombs()) {
      if (!bomb.destroyed()) {
        draft.effect(new MatchEffect.BombRemoved(bomb.id()));
      }
    }
    draft.effect(new MatchEffect.RevertCraters());
    draft.clearDeparted();
    draft.damage = DamageLog.EMPTY;
    draft.pinned.clear();
    draft.setBombs(List.of());
    draft.phase = new Phase.Resetting();
  }

  static Optional<MatchError> resetDone(Draft draft) {
    if (!(draft.phase instanceof Phase.Resetting)) {
      return Optional.of(MatchError.NOT_RESETTING);
    }
    draft.map = Optional.empty();
    draft.phase = Phase.Lobby.EMPTY;
    return Optional.empty();
  }
}
