// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageLog;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * One Search and Destroy match: an immutable state and its transitions. Each event gives the next
 * state and the effects the server must carry out, or the reason the request is refused. Time and
 * world facts arrive with the events and randomness comes from the seed, so the rules are
 * deterministic and a match can be replayed.
 *
 * <p>The flow is lobby (join, pick a kit, vote for a map) → countdown (the vote closes and the
 * chosen map loads) → preparing (only while the map is still loading) → preview (fly over the map)
 * → freeze (teams, kits and spawns dealt) → live (one life each; arm the enemy's bombs, defuse your
 * own, survive the poison) → ended → resetting → lobby, with the humans carried into the next
 * match.
 *
 * @param settings the fixed rules
 * @param matchId this match
 * @param seed the match's randomness: the night roll, the vote's tie-break, team tie-breaks and
 *     poison rolls
 * @param phase where the match is
 * @param map the chosen map, once it is ready
 * @param members everyone in the match, in join order
 * @param departed combatants who left after the match went live, kept for rewards
 * @param bombs the map's bombs once live
 * @param damage every living combatant's recent damage, for kills and assists
 * @param pinned teams an operator assigned members to before the teams are dealt
 */
public record RwfMatch(
    MatchSettings settings,
    UUID matchId,
    long seed,
    Phase phase,
    Optional<MapDefinition> map,
    List<Combatant> members,
    List<Combatant> departed,
    List<Bomb> bombs,
    DamageLog damage,
    Map<CombatantId, TeamColor> pinned) {

  public RwfMatch {
    members = List.copyOf(members);
    departed = List.copyOf(departed);
    bombs = List.copyOf(bombs);
    pinned = Map.copyOf(pinned);
  }

  /** An empty lobby. */
  public static RwfMatch open(MatchSettings settings, UUID matchId, long seed) {
    return new RwfMatch(
        settings,
        matchId,
        seed,
        Phase.Lobby.EMPTY,
        Optional.empty(),
        List.of(),
        List.of(),
        List.of(),
        DamageLog.EMPTY,
        Map.of());
  }

  /**
   * The next match in the lobby this one reset to, with the members it carried over. Their kits
   * stay picked and their belongings stay held; the vote opens afresh.
   */
  public RwfMatch successor(
      MatchSettings nextSettings, UUID nextMatchId, long nextSeed, Instant now) {
    if (!(phase instanceof Phase.Lobby)) {
      throw new IllegalStateException("only a reset lobby has a successor: " + phase);
    }
    var carried = members.stream().map(member -> member.carried(now)).toList();
    return new RwfMatch(
        nextSettings,
        nextMatchId,
        nextSeed,
        carried.isEmpty() ? Phase.Lobby.EMPTY : new Phase.Lobby(Optional.of(now), Ballot.NONE),
        Optional.empty(),
        carried,
        List.of(),
        List.of(),
        DamageLog.EMPTY,
        Map.of());
  }

  /** Applies {@code event}. */
  public Result<Step, MatchError> on(MatchEvent event) {
    var draft = new Draft(this);
    Optional<MatchError> refusal =
        switch (event) {
          case MatchEvent.Join join -> Roster.join(draft, join);
          case MatchEvent.Leave leave -> Roster.leave(draft, leave.id(), leave.now());
          case MatchEvent.Disconnect disconnect -> {
            Roster.disconnect(draft, disconnect.id(), disconnect.now());
            yield Optional.empty();
          }
          case MatchEvent.PickKit pick -> Roster.pickKit(draft, pick.id(), pick.kitId(), false);
          case MatchEvent.ForceKit force -> Roster.pickKit(draft, force.id(), force.kitId(), true);
          case MatchEvent.BallotOpened opened -> Voting.opened(draft, opened.candidates());
          case MatchEvent.Vote vote -> Voting.cast(draft, vote.id(), vote.mapId());
          case MatchEvent.SetMap set -> Voting.set(draft, set.candidate());
          case MatchEvent.MapReady ready -> Flow.mapReady(draft, ready.map(), ready.now());
          case MatchEvent.MapFailed failed -> Voting.failed(draft, failed.mapId());
          case MatchEvent.MapQuarantined quarantined ->
              Voting.quarantined(draft, quarantined.mapId());
          case MatchEvent.Tick tick -> {
            Flow.tick(draft, tick);
            yield Optional.empty();
          }
          case MatchEvent.ForceStart start -> Flow.forceStart(draft, start.now());
          case MatchEvent.Skip skip -> Flow.skip(draft, skip.now());
          case MatchEvent.Extend extend -> Flow.extend(draft, extend.by());
          case MatchEvent.AssignTeam assign -> Roster.assignTeam(draft, assign.id(), assign.team());
          case MatchEvent.Stop _ -> Flow.stop(draft);
          case MatchEvent.Damaged damaged -> {
            Standings.damaged(draft, damaged);
            yield Optional.empty();
          }
          case MatchEvent.Died died -> {
            Standings.died(draft, died);
            yield Optional.empty();
          }
          case MatchEvent.BombClicked click -> Bombs.click(draft, click);
          case MatchEvent.LookedAround looked -> {
            Standings.lookedAround(draft, looked.id());
            yield Optional.empty();
          }
          case MatchEvent.ResetDone _ -> Flow.resetDone(draft);
        };
    return refusal
        .<Result<Step, MatchError>>map(Result::err)
        .orElseGet(() -> Result.ok(draft.step()));
  }

  public Optional<Combatant> member(CombatantId id) {
    return members.stream().filter(member -> member.id().equals(id)).findFirst();
  }

  public Optional<Bomb> bomb(String bombId) {
    return bombs.stream().filter(bomb -> bomb.id().equals(bombId)).findFirst();
  }

  /** The map vote, while the lobby and the countdown run. */
  public Optional<Ballot> ballot() {
    return phase.vote();
  }

  /** Whether this match is played at night: one in {@link Flow#NIGHT_ODDS}, from the seed. */
  public boolean night() {
    return Flow.night(seed);
  }

  /** Fixed world time at the start, also used to settle a seeded showcase before combat. */
  public long startingWorldTime() {
    return Flow.startingWorldTime(seed);
  }

  /** The same lobby under {@code next} rules; only a lobby with no vote open yet may change. */
  public RwfMatch withSettings(MatchSettings next) {
    if (!(phase instanceof Phase.Lobby lobby) || lobby.ballot().opened()) {
      throw new IllegalStateException("only a lobby with no vote open changes its rules");
    }
    return new RwfMatch(next, matchId, seed, phase, map, members, departed, bombs, damage, pinned);
  }

  /** Reconfigures only an empty lobby, preserving its identity, map, ballot and rules. */
  public RwfMatch reseedEmptyLobby(long nextSeed) {
    if (!(phase instanceof Phase.Lobby) || !members.isEmpty()) {
      throw new IllegalStateException("Only an empty lobby can be reseeded.");
    }
    return new RwfMatch(
        settings, matchId, nextSeed, phase, map, members, departed, bombs, damage, pinned);
  }

  /**
   * A transition's outcome.
   *
   * @param match the match afterwards
   * @param effects what the server must do, in order
   */
  public record Step(RwfMatch match, List<MatchEffect> effects) {

    public Step {
      effects = List.copyOf(effects);
    }
  }
}
