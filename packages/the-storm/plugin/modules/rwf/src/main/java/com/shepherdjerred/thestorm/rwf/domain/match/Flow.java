// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/LobbyManager.java,
// GameManager.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java,
// onGameStart/onPoison); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonDamage;
import com.shepherdjerred.thestorm.rwf.domain.reward.Participation;
import com.shepherdjerred.thestorm.rwf.domain.reward.RewardEligibility;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;

/** The lobby, the countdown, going live, the poison, the end and the reset. */
final class Flow {

  /** World time for a night match. */
  static final long NIGHT_TICKS = 15000;

  /** One match in this many is played at night. */
  static final int NIGHT_ODDS = 5;

  private Flow() {}

  /** Whether the match with {@code seed} is played at night. */
  static boolean night(long seed) {
    return new SplittableRandom(seed).nextInt(NIGHT_ODDS) == 0;
  }

  static long startingWorldTime(long seed) {
    return night(seed) ? NIGHT_TICKS : 0;
  }

  static void tick(Draft draft, MatchEvent.Tick tick) {
    switch (draft.phase) {
      case Phase.Lobby lobby -> lobbyTick(draft, lobby, tick.now());
      case Phase.Countdown countdown -> countdownTick(draft, countdown, tick.now());
      case Phase.Live _ -> {
        Bombs.tick(draft, tick.now());
        if (draft.phase instanceof Phase.Live still) {
          poisonTick(draft, still, tick);
        }
        Standings.check(draft, tick.now());
      }
      case Phase.Ended ended -> {
        if (!tick.now().isBefore(ended.at().plus(draft.settings.endLinger()))) {
          reset(draft);
        }
      }
      case Phase.Resetting _ -> {}
    }
  }

  private static void lobbyTick(Draft draft, Phase.Lobby lobby, Instant now) {
    if (draft.members().isEmpty()) {
      draft.phase = Phase.Lobby.EMPTY;
      return;
    }
    var waitingSince = lobby.waitingSince().orElse(now);
    draft.phase = new Phase.Lobby(Optional.of(waitingSince));
    if (draft.map.isPresent() && enoughPlayers(draft, waitingSince, now)) {
      var seconds = draft.settings.countdown().toSeconds();
      draft.phase =
          new Phase.Countdown(now.plus(draft.settings.countdown()), waitingSince, (int) seconds);
      draft.announce(Notice.of(NoticeKind.COUNTDOWN, "seconds", seconds));
      draft.sound(draft.ids(), SoundCue.COUNTDOWN);
    }
  }

  private static boolean enoughPlayers(Draft draft, Instant waitingSince, Instant now) {
    var required = draft.settings.requiredPlayers(Duration.between(waitingSince, now));
    return draft.members().size() >= required;
  }

  private static void countdownTick(Draft draft, Phase.Countdown countdown, Instant now) {
    if (draft.map.isEmpty() || !enoughPlayers(draft, countdown.waitingSince(), now)) {
      draft.phase = new Phase.Lobby(Optional.of(countdown.waitingSince()));
      draft.announce(Notice.of(NoticeKind.COUNTDOWN_CANCELLED));
      return;
    }
    if (!now.isBefore(countdown.startsAt())) {
      start(draft, now);
      return;
    }
    var remaining = (int) Math.ceil(Duration.between(now, countdown.startsAt()).toMillis() / 1000D);
    if (remaining != countdown.lastAnnounced() && announcedCountdown(remaining)) {
      draft.phase = new Phase.Countdown(countdown.startsAt(), countdown.waitingSince(), remaining);
      draft.announce(Notice.of(NoticeKind.COUNTDOWN, "seconds", remaining));
      draft.sound(draft.ids(), SoundCue.COUNTDOWN);
    }
  }

  /** Red Warfare announced 30, 15, 10 and every second from 5. */
  static boolean announcedCountdown(int seconds) {
    return seconds <= 5 || seconds == 10 || seconds == 15 || seconds == 30;
  }

  static Optional<MatchError> forceStart(Draft draft, Instant now) {
    if (!draft.phase.preGame()) {
      return Optional.of(MatchError.NOT_PRE_GAME);
    }
    if (draft.map.isEmpty()) {
      return Optional.of(MatchError.NO_MAP);
    }
    if (draft.members().size() < draft.settings.absoluteMinPlayers()) {
      return Optional.of(MatchError.TOO_FEW_PLAYERS);
    }
    start(draft, now);
    return Optional.empty();
  }

  /** The match goes live: teams are balanced, kits given, bombs placed and the clock started. */
  private static void start(Draft draft, Instant now) {
    var map = draft.map();
    var assignment =
        TeamBalancer.assign(draft.ids(), map.teamColors(), new SplittableRandom(draft.seed));
    var placed = new EnumMap<TeamColor, Integer>(TeamColor.class);
    for (var member : draft.members()) {
      var team = Objects.requireNonNull(assignment.get(member.id()), "every member gets a team");
      var kitId = member.kit().orElseGet(KitBook.TROOPER::id);
      var kit =
          KitBook.byId(kitId)
              .orElseThrow(() -> new IllegalStateException("picked kit vanished: " + kitId));
      draft.put(member.fighting(team, kitId, kit.fuseBonus()));
      var spawns = map.team(team).orElseThrow().spawns();
      var index = placed.merge(team, 1, Integer::sum) - 1;
      draft.effect(new MatchEffect.Equip(member.id(), kitId));
      draft.effect(new MatchEffect.Teleport(member.id(), spawns.get(index % spawns.size())));
      draft.tell(member.id(), Notice.of(NoticeKind.YOU_ARE_IN_TEAM, "team", team.displayName()));
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
      draft.tell(id, Notice.of(NoticeKind.CREDITS_GIVEN, "credits", award.credits()));
    }
  }

  private static Optional<Participation> participation(Combatant member) {
    return member
        .team()
        .map(
            team ->
                new Participation(
                    member.id(), team, true, member.diedAt(), member.leftAt(), member.forfeited()));
  }

  static Optional<MatchError> stop(Draft draft) {
    if (draft.phase instanceof Phase.Resetting) {
      return Optional.of(MatchError.ALREADY_RESETTING);
    }
    if (draft.phase instanceof Phase.Live) {
      draft.announce(Notice.of(NoticeKind.STOPPED));
    }
    reset(draft);
    return Optional.empty();
  }

  /** Everyone is restored and the adapter told to revert the map. */
  private static void reset(Draft draft) {
    for (CombatantId id : draft.ids()) {
      draft.effect(new MatchEffect.Restore(id));
    }
    for (var bomb : draft.bombs()) {
      if (!bomb.destroyed()) {
        draft.effect(new MatchEffect.BombRemoved(bomb.id()));
      }
    }
    draft.effect(new MatchEffect.RevertCraters());
    draft.clearRoster();
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
