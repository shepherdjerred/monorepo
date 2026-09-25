package com.shepherdjerred.thestorm.arena.domain.game;

import com.shepherdjerred.thestorm.arena.domain.reward.RewardLedger;
import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * One arena's game: an immutable state and its transitions. Each event gives the next state and the
 * effects the server must carry out, or the reason the request is refused. Time arrives with the
 * events, so the rules are deterministic.
 *
 * <p>The flow is lobby (join, pick a class, ready) → countdown → waves → the end (every fighter
 * dead or gone, the final wave cleared, or a stop), after which the arena is an empty lobby again.
 * A player is emptied in the same tick their snapshot is taken (so nothing they do while it is
 * stored can be duplicated), and everyone who joined is restored exactly once, whichever way they
 * leave.
 *
 * @param setup the arena's fixed rules
 * @param phase where the game is
 * @param members everyone in the arena, in the order they joined
 * @param ledger crystals paid to each player this game
 */
public record ArenaGame(Setup setup, Phase phase, List<Member> members, RewardLedger ledger) {

  public ArenaGame {
    members = List.copyOf(members);
  }

  /** An empty arena. */
  public static ArenaGame open(Setup setup) {
    return new ArenaGame(setup, new Phase.Lobby(), List.of(), RewardLedger.EMPTY);
  }

  /** Applies {@code event}. */
  public Result<Step, GameError> on(GameEvent event) {
    var draft = new Draft(this);
    Optional<GameError> refusal =
        switch (event) {
          case GameEvent.Join join -> Roster.join(draft, join);
          case GameEvent.Spectate spectate -> Roster.spectate(draft, spectate);
          case GameEvent.SnapshotStored stored -> {
            Roster.stored(draft, stored.player());
            yield Optional.empty();
          }
          case GameEvent.SnapshotFailed failed -> {
            Roster.failed(draft, failed.player());
            yield Optional.empty();
          }
          case GameEvent.PickClass pick -> Roster.pickClass(draft, pick);
          case GameEvent.Ready ready -> Roster.ready(draft, ready.player());
          case GameEvent.Leave leave -> leave(draft, leave.player());
          case GameEvent.Disconnect disconnect -> {
            draft.member(disconnect.player()).ifPresent(member -> Roster.leave(draft, member));
            yield Optional.empty();
          }
          case GameEvent.Died died -> {
            draft.member(died.player()).ifPresent(member -> Roster.died(draft, member));
            yield Optional.empty();
          }
          case GameEvent.Tick tick -> {
            Waves.tick(draft, tick.now(), tick.alive());
            yield Optional.empty();
          }
          case GameEvent.ForceStart start -> Waves.forceStart(draft, start.now());
          case GameEvent.Stop _ -> {
            Roster.stop(draft);
            yield Optional.empty();
          }
        };
    return refusal
        .<Result<Step, GameError>>map(Result::err)
        .orElseGet(() -> Result.ok(draft.step()));
  }

  private static Optional<GameError> leave(Draft draft, UUID player) {
    var member = draft.member(player);
    if (member.isEmpty()) {
      return Optional.of(GameError.NOT_A_MEMBER);
    }
    Roster.leave(draft, member.orElseThrow());
    return Optional.empty();
  }

  public Optional<Member> member(UUID player) {
    return members.stream().filter(member -> member.id().equals(player)).findFirst();
  }

  /** Whether nobody is in the arena. */
  public boolean isEmpty() {
    return members.isEmpty();
  }

  /** The fighters, in join order. */
  public List<Member.Fighter> fighters() {
    return members.stream()
        .filter(Member.Fighter.class::isInstance)
        .map(Member.Fighter.class::cast)
        .toList();
  }

  /**
   * A transition's outcome.
   *
   * @param game the game afterwards
   * @param effects what the server must do, in order
   */
  public record Step(ArenaGame game, List<GameEffect> effects) {

    public Step {
      effects = List.copyOf(effects);
    }
  }
}
