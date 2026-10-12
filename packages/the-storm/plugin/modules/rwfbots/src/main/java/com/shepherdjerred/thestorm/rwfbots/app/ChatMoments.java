package com.shepherdjerred.thestorm.rwfbots.app;

import static java.util.function.Predicate.not;

import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwf.app.view.Transition;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatMoment;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatScene;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * Reads rwf's match transitions as chat moments: a bot walking into the lobby, the match going
 * live, deaths with their killer, bombs finishing arming or being defused, and the end with its
 * winner. Names come out as players read them in game: combatant names, {@code Red Team}, {@code
 * Blue Team's bomb}, {@code the nuke}.
 */
public final class ChatMoments {

  private ChatMoments() {}

  /** The moments in {@code transition}, given the match {@code before} it, in order. */
  public static List<ChatMoment> of(MatchState before, Transition transition) {
    var after = transition.after();
    var wasLive = before.phase() == MatchState.Phase.LIVE;
    var moments = new ArrayList<ChatMoment>();
    if (!wasLive && after.phase() == MatchState.Phase.LIVE) {
      moments.add(new ChatMoment.Started());
    }
    if (!wasLive) {
      if (transition.change() instanceof Transition.Change.Joined joined
          && after.combatant(joined.uuid()).filter(MatchState.Fighter::bot).isPresent()) {
        moments.add(new ChatMoment.Arrived(joined.uuid()));
      }
      return moments;
    }
    if (transition.change() instanceof Transition.Change.Died died) {
      moments.add(new ChatMoment.Died(died.victim(), died.killer()));
    }
    for (var effect : transition.effects()) {
      switch (effect) {
        case Transition.Effect.Killed killed ->
            killed
                .victims()
                .forEach(victim -> moments.add(new ChatMoment.Died(victim, Optional.empty())));
        case Transition.Effect.StatRecorded stat when stat.stat().equals("Armed") ->
            moments.add(planted(before, after, stat.uuid()));
        case Transition.Effect.StatRecorded stat when stat.stat().equals("Defused") ->
            moments.add(defused(before, after, stat.uuid()));
        case Transition.Effect.StatRecorded _,
            Transition.Effect.Teleported _,
            Transition.Effect.Equipped _,
            Transition.Effect.Restored _,
            Transition.Effect.Spectating _ -> {}
      }
    }
    if (after.phase() == MatchState.Phase.ENDED) {
      moments.add(new ChatMoment.Ended(after.winner().map(ChatMoments::teamName)));
    }
    return moments;
  }

  /** {@code state} as chat sees it, with each bot's personality from {@code bots}. */
  public static ChatScene scene(MatchState state, Function<UUID, Optional<Personality>> bots) {
    return new ChatScene(
        state.combatants().stream()
            .map(
                fighter ->
                    new ChatScene.Member(
                        fighter.uuid(),
                        fighter.name(),
                        fighter.bot() ? bots.apply(fighter.uuid()) : Optional.empty(),
                        fighter.team().map(ChatMoments::teamName),
                        fighter.alive()))
            .toList());
  }

  /** {@code red} as players read it: {@code Red Team}. */
  public static String teamName(String team) {
    if (team.isEmpty()) {
      throw new IllegalArgumentException("team name must not be empty");
    }
    return team.substring(0, 1).toUpperCase(Locale.ROOT) + team.substring(1) + " Team";
  }

  /** {@code bomb} as players read it: {@code the nuke} or {@code Blue Team's bomb}. */
  public static String bombName(MatchState.Bomb bomb) {
    if (bomb.nuke()) {
      return "the nuke";
    }
    var owner =
        bomb.team().orElseThrow(() -> new IllegalStateException(bomb.id() + " has no owner"));
    return teamName(owner) + "'s bomb";
  }

  /** The bomb that just became armed; a nuke counts as the arming team's. */
  private static ChatMoment.Planted planted(MatchState before, MatchState after, UUID planter) {
    var bomb =
        changed(before, after, not(ChatMoments::armed), ChatMoments::armed)
            .orElseThrow(() -> new IllegalStateException("an Armed stat with no bomb armed"));
    return new ChatMoment.Planted(planter, bombName(bomb), bomb.nuke());
  }

  /** The bomb that was armed before and is idle again. */
  private static ChatMoment.Defused defused(MatchState before, MatchState after, UUID defuser) {
    var bomb =
        changed(
                before,
                after,
                ChatMoments::armed,
                state -> state.status() instanceof MatchState.Status.Idle)
            .orElseThrow(() -> new IllegalStateException("a Defused stat with no bomb defused"));
    return new ChatMoment.Defused(defuser, bombName(bomb));
  }

  /** The first bomb that was {@code was} before the transition and is {@code now} after it. */
  private static Optional<MatchState.Bomb> changed(
      MatchState before,
      MatchState after,
      Predicate<MatchState.Bomb> was,
      Predicate<MatchState.Bomb> now) {
    return after.bombs().stream()
        .filter(now)
        .filter(bomb -> before.bomb(bomb.id()).filter(was).isPresent())
        .findFirst();
  }

  private static boolean armed(MatchState.Bomb bomb) {
    return bomb.status() instanceof MatchState.Status.Armed;
  }
}
