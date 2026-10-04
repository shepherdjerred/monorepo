// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * One Search and Destroy match: an immutable state and its transitions. Each event gives the next
 * state and the effects the server must carry out, or the reason the request is refused. Time and
 * world facts arrive with the events and randomness comes from the seed, so the rules are
 * deterministic and a match can be replayed.
 *
 * <p>The flow is lobby (join, pick a kit, choose a map) → countdown → live (one life each; arm the
 * enemy's bombs, defuse your own, survive the poison) → ended → resetting → lobby.
 *
 * @param settings the fixed rules
 * @param matchId this match
 * @param seed the match's randomness: the night roll, team tie-breaks and poison rolls
 * @param phase where the match is
 * @param map the chosen map
 * @param members everyone in the match, in join order
 * @param departed combatants who left after the match went live, kept for rewards
 * @param bombs the map's bombs once live
 */
public record RwfMatch(
    MatchSettings settings,
    UUID matchId,
    long seed,
    Phase phase,
    Optional<MapDefinition> map,
    List<Combatant> members,
    List<Combatant> departed,
    List<Bomb> bombs) {

  public RwfMatch {
    members = List.copyOf(members);
    departed = List.copyOf(departed);
    bombs = List.copyOf(bombs);
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
        List.of());
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
          case MatchEvent.PickKit pick -> Roster.pickKit(draft, pick);
          case MatchEvent.MapChosen chosen -> Roster.mapChosen(draft, chosen.map());
          case MatchEvent.Tick tick -> {
            Flow.tick(draft, tick);
            yield Optional.empty();
          }
          case MatchEvent.ForceStart start -> Flow.forceStart(draft, start.now());
          case MatchEvent.Stop _ -> Flow.stop(draft);
          case MatchEvent.Died died -> {
            Standings.died(draft, died);
            yield Optional.empty();
          }
          case MatchEvent.BombClicked click -> Bombs.click(draft, click);
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

  /** Whether this match is played at night: one in {@link Flow#NIGHT_ODDS}, from the seed. */
  public boolean night() {
    return Flow.night(seed);
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
