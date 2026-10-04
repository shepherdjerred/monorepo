package com.shepherdjerred.thestorm.rwf.app.view;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * The running match as other modules read it: the {@link MatchSnapshot} flattened to plain values
 * (UUIDs, lower-case team names, kit and bomb ids) so a consumer needs nothing from {@code
 * rwf.domain}. Built once per snapshot and never mutated.
 *
 * @param matchId the match
 * @param phase where the match is
 * @param mapId the chosen map, if any
 * @param teams the map's teams in scoreboard order, as lower-case colour names
 * @param combatants everyone in the match
 * @param bombs every bomb and nuke; empty before the match is live
 * @param poison the end-of-game poison while live
 * @param winner the winning team once ended with a winner
 */
public record MatchState(
    UUID matchId,
    Phase phase,
    Optional<String> mapId,
    List<String> teams,
    List<Fighter> combatants,
    List<Bomb> bombs,
    Optional<Poison> poison,
    Optional<String> winner) {

  public MatchState {
    teams = List.copyOf(teams);
    combatants = List.copyOf(combatants);
    bombs = List.copyOf(bombs);
  }

  /** The phase, flattened. */
  public enum Phase {
    LOBBY,
    COUNTDOWN,
    LIVE,
    ENDED,
    RESETTING
  }

  /**
   * One combatant.
   *
   * @param uuid the entity's UUID (for a bot, the UUID of the entity that embodies it)
   * @param name their name
   * @param personalityId the personality driving a bot; empty for a human
   * @param team their team once the match has started, lower-case
   * @param kit their kit id
   * @param alive whether they are still fighting
   */
  public record Fighter(
      UUID uuid,
      String name,
      Optional<String> personalityId,
      Optional<String> team,
      Optional<String> kit,
      boolean alive) {

    public boolean bot() {
      return personalityId.isPresent();
    }
  }

  /**
   * One bomb.
   *
   * @param id the bomb id
   * @param nuke whether it is a nuke
   * @param team its owner, or for an armed nuke the team that armed it, lower-case
   * @param x the TNT block
   * @param y the TNT block
   * @param z the TNT block
   * @param status what it is doing
   */
  public record Bomb(
      String id, boolean nuke, Optional<String> team, int x, int y, int z, Status status) {}

  /** What a bomb is doing. */
  public sealed interface Status {

    /** Nothing. */
    record Idle() implements Status {}

    /**
     * Being armed, or defused, by {@code team}.
     *
     * @param team who is working on it, lower-case
     * @param progress 0..1 of the time done
     * @param clickers who has clicked this attempt
     */
    record Working(String team, double progress, List<UUID> clickers) implements Status {

      public Working {
        clickers = List.copyOf(clickers);
      }
    }

    /**
     * Primed and counting down.
     *
     * @param remainingSeconds seconds left
     * @param defusing the team closest to defusing it, if any
     */
    record Armed(int remainingSeconds, Optional<Working> defusing) implements Status {}

    /** Exploded or removed. */
    record Destroyed() implements Status {}
  }

  /**
   * The end-of-game poison.
   *
   * @param deadly whether it is already hurting players
   * @param untilDamageMillis how long until it starts hurting; zero once it has
   */
  public record Poison(boolean deadly, long untilDamageMillis) {}

  /** The lower-case name the view uses for {@code color}. */
  public static String teamName(TeamColor color) {
    return color.name().toLowerCase(Locale.ROOT);
  }

  public static MatchState of(MatchSnapshot snapshot) {
    return new MatchState(
        snapshot.matchId(),
        switch (snapshot.phase()) {
          case LOBBY -> Phase.LOBBY;
          case COUNTDOWN -> Phase.COUNTDOWN;
          case LIVE -> Phase.LIVE;
          case ENDED -> Phase.ENDED;
          case RESETTING -> Phase.RESETTING;
        },
        snapshot.mapId(),
        snapshot.teams().stream().map(MatchState::teamName).toList(),
        snapshot.combatants().stream().map(MatchState::fighter).toList(),
        snapshot.bombs().stream().map(MatchState::bomb).toList(),
        snapshot
            .poison()
            .map(
                poison ->
                    new Poison(poison.untilDamage().isZero(), poison.untilDamage().toMillis())),
        snapshot.outcome().flatMap(outcome -> outcome.winner()).map(MatchState::teamName));
  }

  private static Fighter fighter(MatchSnapshot.CombatantView view) {
    var personality =
        switch (view.id()) {
          case CombatantId.Bot bot -> Optional.of(bot.personalityId());
          case CombatantId.Human _ -> Optional.<String>empty();
        };
    return new Fighter(
        view.id().uuid(),
        view.name(),
        personality,
        view.team().map(MatchState::teamName),
        view.kit(),
        view.alive());
  }

  private static Bomb bomb(MatchSnapshot.BombView view) {
    return new Bomb(
        view.id(),
        view.nuke(),
        view.team().map(MatchState::teamName),
        view.position().x(),
        view.position().y(),
        view.position().z(),
        status(view.state()));
  }

  private static Status status(MatchSnapshot.BombView.State state) {
    return switch (state) {
      case MatchSnapshot.BombView.State.Idle _ -> new Status.Idle();
      case MatchSnapshot.BombView.State.Arming arming -> working(arming);
      case MatchSnapshot.BombView.State.Armed armed ->
          new Status.Armed(armed.remaining(), armed.defusing().map(MatchState::working));
      case MatchSnapshot.BombView.State.Destroyed _ -> new Status.Destroyed();
    };
  }

  private static Status.Working working(MatchSnapshot.BombView.State.Arming arming) {
    return new Status.Working(
        teamName(arming.team()),
        arming.progress(),
        arming.clickers().stream().map(CombatantId::uuid).toList());
  }

  public Optional<Fighter> combatant(UUID uuid) {
    return combatants.stream().filter(fighter -> fighter.uuid().equals(uuid)).findFirst();
  }

  public Optional<Bomb> bomb(String id) {
    return bombs.stream().filter(bomb -> bomb.id().equals(id)).findFirst();
  }
}
