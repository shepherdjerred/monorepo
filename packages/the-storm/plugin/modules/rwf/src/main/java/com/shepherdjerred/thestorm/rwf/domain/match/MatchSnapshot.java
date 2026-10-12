package com.shepherdjerred.thestorm.rwf.domain.match;

import static java.util.Comparator.comparing;

import com.shepherdjerred.thestorm.rwf.domain.bomb.ArmAttempt;
import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.bomb.BombState;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * A read model of a match at one instant, for scoreboards, holograms, bots and recordings. Built
 * from the match; never mutated.
 *
 * @param matchId the match
 * @param phase where the match is
 * @param now when the snapshot was taken
 * @param mapId the map the match is played on: the loaded map, or the one its vote chose while it
 *     loads
 * @param teams the map's teams in scoreboard order; empty before a map is chosen
 * @param combatants everyone in the match
 * @param bombs every bomb and nuke; empty before the match is live
 * @param poison the end-of-game poison while live
 * @param outcome the result once ended
 * @param startsAt when the countdown ends, or the preview or freeze does
 * @param ballot the map vote while the lobby, the countdown or the preparation runs
 */
public record MatchSnapshot(
    UUID matchId,
    PhaseKind phase,
    Instant now,
    Optional<String> mapId,
    List<TeamColor> teams,
    List<CombatantView> combatants,
    List<BombView> bombs,
    Optional<PoisonView> poison,
    Optional<Outcome> outcome,
    Optional<Instant> startsAt,
    Optional<Ballot> ballot) {

  public MatchSnapshot {
    teams = List.copyOf(teams);
    combatants = List.copyOf(combatants);
    bombs = List.copyOf(bombs);
  }

  /** The phase, flattened for consumers that do not need its data. */
  public enum PhaseKind {
    LOBBY,
    COUNTDOWN,
    PREPARING,
    PREVIEW,
    FREEZE,
    LIVE,
    ENDED,
    RESETTING,
  }

  public static MatchSnapshot of(RwfMatch match, Instant now) {
    return new MatchSnapshot(
        match.matchId(),
        kind(match.phase()),
        now,
        match.map().map(MapDefinition::id).or(() -> match.ballot().flatMap(Ballot::chosen)),
        match.map().map(MapDefinition::teamColors).orElseGet(List::of),
        match.members().stream().map(member -> CombatantView.of(member, match)).toList(),
        match.bombs().stream().map(bomb -> BombView.of(bomb, now)).toList(),
        match.phase() instanceof Phase.Live live
            ? Optional.of(new PoisonView(live.poison().stage(), live.poison().untilPoison(now)))
            : Optional.empty(),
        match.phase() instanceof Phase.Ended ended
            ? Optional.of(ended.outcome())
            : Optional.empty(),
        deadline(match.phase()),
        match.ballot());
  }

  private static Optional<Instant> deadline(Phase phase) {
    return switch (phase) {
      case Phase.Countdown countdown -> Optional.of(countdown.startsAt());
      case Phase.Preview preview -> Optional.of(preview.until());
      case Phase.Freeze freeze -> Optional.of(freeze.until());
      default -> Optional.empty();
    };
  }

  private static PhaseKind kind(Phase phase) {
    return switch (phase) {
      case Phase.Lobby _ -> PhaseKind.LOBBY;
      case Phase.Countdown _ -> PhaseKind.COUNTDOWN;
      case Phase.Preparing _ -> PhaseKind.PREPARING;
      case Phase.Preview _ -> PhaseKind.PREVIEW;
      case Phase.Freeze _ -> PhaseKind.FREEZE;
      case Phase.Live _ -> PhaseKind.LIVE;
      case Phase.Ended _ -> PhaseKind.ENDED;
      case Phase.Resetting _ -> PhaseKind.RESETTING;
    };
  }

  public Optional<CombatantView> combatant(CombatantId id) {
    return combatants.stream().filter(view -> view.id().equals(id)).findFirst();
  }

  public Optional<BombView> bomb(String id) {
    return bombs.stream().filter(view -> view.id().equals(id)).findFirst();
  }

  /**
   * One combatant.
   *
   * @param id who
   * @param name their name
   * @param team their team once the match has started
   * @param kit their kit
   * @param alive whether they are still fighting
   * @param score their kills, assists and killstreak this match
   */
  public record CombatantView(
      CombatantId id,
      String name,
      Optional<TeamColor> team,
      Optional<String> kit,
      boolean alive,
      boolean disguised,
      Score score) {

    static CombatantView of(Combatant combatant, RwfMatch match) {
      var disguised =
          combatant.alive()
              && combatant
                  .kit()
                  .filter(kit -> match.abilities().disguised(combatant.id(), kit))
                  .isPresent();
      return new CombatantView(
          combatant.id(),
          combatant.name(),
          combatant.team(),
          combatant.kit(),
          combatant.alive(),
          disguised,
          combatant.score());
    }

    /**
     * The team a viewer on {@code viewerTeam} believes this combatant is on: the viewer's own for a
     * disguised Spy or dressed Skinner, the real team otherwise.
     */
    public Optional<TeamColor> apparentTeam(Optional<TeamColor> viewerTeam) {
      return disguised && viewerTeam.isPresent() && !viewerTeam.equals(team) ? viewerTeam : team;
    }
  }

  /**
   * One bomb.
   *
   * @param id the bomb
   * @param nuke whether it is a nuke
   * @param team its owner, or for a nuke the team that armed it
   * @param position the TNT block
   * @param state what it is doing
   * @param progress every team's arming or defusing progress, best first, for the hologram
   */
  public record BombView(
      String id,
      boolean nuke,
      Optional<TeamColor> team,
      BlockPos position,
      State state,
      List<State.Arming> progress) {

    public BombView {
      progress = List.copyOf(progress);
    }

    /** The progress a bomb in {@code state} shows when no other team is at work on it. */
    public static List<State.Arming> progressOf(State state) {
      return switch (state) {
        case State.Arming arming -> List.of(arming);
        case State.Armed armed -> armed.defusing().stream().toList();
        default -> List.of();
      };
    }

    static BombView of(Bomb bomb, Instant now) {
      return new BombView(
          bomb.id(),
          bomb.isNuke(),
          bomb.team(),
          bomb.site().position(),
          state(bomb, now),
          bomb.state().attempts().stream()
              .filter(attempt -> attempt.valid(now))
              .sorted(comparing(ArmAttempt::finishesAt))
              .map(attempt -> State.Arming.of(attempt, now))
              .toList());
    }

    private static State state(Bomb bomb, Instant now) {
      return switch (bomb.state()) {
        case BombState.Idle idle ->
            leading(idle.attempts(), now)
                .<State>map(attempt -> State.Arming.of(attempt, now))
                .orElseGet(State.Idle::new);
        case BombState.Armed armed ->
            new State.Armed(
                armed.remaining(),
                leading(armed.attempts(), now).map(a -> State.Arming.of(a, now)));
        case BombState.Destroyed _ -> new State.Destroyed();
      };
    }

    private static Optional<ArmAttempt> leading(List<ArmAttempt> attempts, Instant now) {
      return attempts.stream()
          .filter(attempt -> attempt.valid(now))
          .min(comparing(ArmAttempt::finishesAt));
    }

    /** What a bomb is doing. */
    public sealed interface State {

      /** Nothing. */
      record Idle() implements State {}

      /** Being armed; the team closest to finishing is shown. */
      record Arming(TeamColor team, double progress, List<CombatantId> clickers) implements State {

        public Arming {
          clickers = List.copyOf(clickers);
        }

        static Arming of(ArmAttempt attempt, Instant now) {
          return new Arming(attempt.team(), attempt.progress(now), attempt.clickers());
        }
      }

      /**
       * Primed and counting down.
       *
       * @param remaining seconds left
       * @param defusing the team closest to defusing it, if any
       */
      record Armed(int remaining, Optional<Arming> defusing) implements State {}

      /** Exploded or removed. */
      record Destroyed() implements State {}
    }
  }

  /**
   * The end-of-game poison.
   *
   * @param stage how far it has got
   * @param untilDamage how long until it starts hurting; zero once it has
   */
  public record PoisonView(PoisonClock.Stage stage, Duration untilDamage) {}
}
