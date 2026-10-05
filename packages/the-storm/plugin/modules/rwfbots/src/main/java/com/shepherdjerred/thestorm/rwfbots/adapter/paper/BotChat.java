package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwf.app.view.Transition;
import com.shepherdjerred.thestorm.rwfbots.app.ChatGate;
import com.shepherdjerred.thestorm.rwfbots.app.ChatMoments;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatDirector;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatMoment;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatScene;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatSettings;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.Utterance;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
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
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.World;
import org.jspecify.annotations.Nullable;

/**
 * Lets the bots talk. Listens to rwf's match transitions, reads them as chat moments, asks one
 * {@link ChatDirector} per match (seeded from the match, alive from its lobby to its end) who says
 * what, and shows each line when it is due to the human players in the match world: members and
 * watchers, never Global, Discord or anyone elsewhere. A line reads like player chat with rwf's dim
 * {@code ✦} bot marker after the name, the name in the bot's team colour (white in the lobby,
 * before teams exist). In the lobby bots greet as they walk in, answer a human who chats there,
 * make small talk and remark on the countdown's last seconds. Every second it offers the director
 * an idle moment and, every {@code flagRefresh}, evaluates the managed Flipt flag off the main
 * thread; the cached answer gates every line, so the flag off, an evaluation failure or no answer
 * yet keeps bots silent. Main thread only.
 */
public final class BotChat implements Consumer<MatchNotification> {

  static final String MARKER = " ✦";
  private static final Duration IDLE_EVERY = Duration.ofSeconds(1);
  private static final long CHAT_SALT = 0x63686174L;

  /** The countdown's last seconds a bot may remark on. */
  static final Duration COUNTDOWN_CALL = Duration.ofSeconds(10);

  private final Parts parts;
  private final List<Cancellable> pending = new ArrayList<>();
  private final Map<String, String> teamsByName = new HashMap<>();
  private MatchEvents.@Nullable Subscription subscription;
  private @Nullable Cancellable clock;
  private @Nullable MatchState previous;
  private @Nullable ChatDirector director;
  private @Nullable UUID directorMatch;
  private boolean countdownCalled;
  private boolean enabled;
  private boolean checking;
  private boolean closed;
  private Instant nextCheck = Instant.MIN;

  /**
   * What chat works with.
   *
   * @param settings how much bots talk
   * @param flagRefresh how often the flag is evaluated again
   * @param gate the managed rollout flag
   * @param roster the bots, for their personalities and to keep their bodies out of the audience
   * @param world the match world, whose human players hear the bots
   * @param scheduler the main thread
   * @param time the clock
   * @param logger the module logger
   */
  public record Parts(
      ChatSettings settings,
      Duration flagRefresh,
      ChatGate gate,
      Roster roster,
      World world,
      Scheduler scheduler,
      InstantSource time,
      ComponentLogger logger) {}

  public BotChat(Parts parts) {
    this.parts = parts;
  }

  /** Subscribes to the match, starts the idle clock and asks the flag for the first time. */
  public void start(MatchEvents events) {
    subscription = events.subscribe(this);
    clock = parts.scheduler().repeatOnMainThread(IDLE_EVERY, IDLE_EVERY, this::second);
    refresh();
  }

  /** Whether the flag's cached answer lets bots talk. */
  public boolean enabled() {
    return enabled;
  }

  @Override
  public void accept(MatchNotification notification) {
    var transition = Transition.of(notification);
    var after = transition.after();
    for (var team : after.teams()) {
      teamsByName.put(ChatMoments.teamName(team), team);
    }
    var before = previous;
    previous = after;
    if (before == null) {
      // The first transition only tells us where the match is.
      return;
    }
    var now = parts.time().instant();
    var lines = new ArrayList<Utterance>();
    for (var moment : ChatMoments.of(before, transition)) {
      lines.addAll(director(after, now).on(moment, scene(after), now));
    }
    if (after.phase() == MatchState.Phase.RESETTING) {
      director = null;
      directorMatch = null;
    }
    lines.forEach(line -> say(line, now));
  }

  /** The match's director, made the first time the match (its lobby, or its start) needs one. */
  private ChatDirector director(MatchState state, Instant now) {
    var current = director;
    if (current != null && state.matchId().equals(directorMatch)) {
      return current;
    }
    var made =
        new ChatDirector(
            parts.settings(),
            new SplittableRandom(MatchSession.seedOf(state.matchId()) ^ CHAT_SALT),
            now);
    director = made;
    directorMatch = state.matchId();
    countdownCalled = false;
    return made;
  }

  /**
   * A human said {@code text} in chat; when they wait in this match's lobby, one bot may answer.
   * Called on the main thread.
   */
  public void heard(UUID human, String text) {
    var state = previous;
    if (closed || state == null || !lobby(state)) {
      return;
    }
    var speaker = state.combatant(human);
    if (speaker.isEmpty() || speaker.orElseThrow().bot()) {
      return;
    }
    var now = parts.time().instant();
    director(state, now)
        .on(new ChatMoment.HumanSaid(human, text), scene(state), now)
        .forEach(line -> say(line, now));
  }

  private static boolean lobby(MatchState state) {
    return state.phase() == MatchState.Phase.LOBBY || state.phase() == MatchState.Phase.COUNTDOWN;
  }

  /** Once a second: refresh the flag when due and offer an idle taunt during a live match. */
  private void second() {
    var now = parts.time().instant();
    if (!now.isBefore(nextCheck)) {
      refresh();
    }
    var state = previous;
    if (state == null) {
      return;
    }
    if (lobby(state) && state.combatants().stream().anyMatch(MatchState.Fighter::bot)) {
      var lobbyDirector = director(state, now);
      var callDue =
          state.startsAt().filter(start -> !now.isBefore(start.minus(COUNTDOWN_CALL))).isPresent();
      if (callDue && !countdownCalled) {
        countdownCalled = true;
        lobbyDirector
            .on(new ChatMoment.CountdownCall(), scene(state), now)
            .forEach(line -> say(line, now));
      }
      lobbyDirector.on(new ChatMoment.Idle(), scene(state), now).forEach(line -> say(line, now));
      return;
    }
    var current = director;
    if (current == null || state.phase() != MatchState.Phase.LIVE) {
      return;
    }
    current.on(new ChatMoment.Idle(), scene(state), now).forEach(line -> say(line, now));
  }

  private ChatScene scene(MatchState state) {
    return ChatMoments.scene(state, this::personality);
  }

  private Optional<Personality> personality(UUID uuid) {
    return parts.roster().bot(uuid).map(bot -> bot.drafted().personality());
  }

  /** Evaluates the flag off the main thread and caches the answer back on it. */
  private void refresh() {
    if (closed || checking) {
      return;
    }
    checking = true;
    var _ =
        parts
            .gate()
            .enabled()
            .whenCompleteAsync(
                (value, failure) -> {
                  checking = false;
                  nextCheck = parts.time().instant().plus(parts.flagRefresh());
                  if (closed) {
                    return;
                  }
                  enabled = failure == null && value;
                  if (failure != null) {
                    parts
                        .logger()
                        .warn(
                            "rwfbots: the chat flag could not be read; bots stay silent", failure);
                  }
                },
                parts.scheduler().mainThread());
  }

  private void say(Utterance line, Instant now) {
    var delay = Duration.between(now, line.at());
    if (delay.isNegative() || delay.isZero()) {
      show(line);
      return;
    }
    var holder = new Cancellable[1];
    holder[0] =
        parts
            .scheduler()
            .runOnMainThreadLater(
                delay,
                () -> {
                  pending.remove(holder[0]);
                  show(line);
                });
    pending.add(holder[0]);
  }

  private void show(Utterance line) {
    if (closed || !enabled) {
      return;
    }
    var message = render(line, line.team().map(this::color).orElse(NamedTextColor.WHITE));
    for (var player : parts.world().getPlayers()) {
      if (!parts.roster().isBot(player.getUniqueId())) {
        player.sendMessage(message);
      }
    }
  }

  /** {@code [Name ✦]: line}, framed like player chat, the name in its team's colour. */
  static Component render(Utterance line, NamedTextColor team) {
    return Component.text("[", NamedTextColor.DARK_GRAY)
        .append(Component.text(line.name(), team))
        .append(Component.text(MARKER, NamedTextColor.DARK_GRAY))
        .append(Component.text("]: ", NamedTextColor.DARK_GRAY))
        .append(Component.text(line.text(), NamedTextColor.GRAY));
  }

  private NamedTextColor color(String teamName) {
    var team = teamsByName.get(teamName);
    if (team == null) {
      throw new IllegalStateException("a bot spoke for a team the match never had: " + teamName);
    }
    return switch (team) {
      case "red" -> NamedTextColor.RED;
      case "blue" -> NamedTextColor.BLUE;
      case "green" -> NamedTextColor.GREEN;
      case "purple" -> NamedTextColor.DARK_PURPLE;
      case "yellow" -> NamedTextColor.YELLOW;
      default -> throw new IllegalStateException("rwf has no team colour " + team);
    };
  }

  /** Unsubscribes, stops the clock, drops lines not yet said and closes the flag client. */
  public void close() {
    closed = true;
    var current = subscription;
    if (current != null) {
      current.close();
      subscription = null;
    }
    var running = clock;
    if (running != null) {
      running.cancel();
      clock = null;
    }
    List.copyOf(pending).forEach(Cancellable::cancel);
    pending.clear();
    director = null;
    directorMatch = null;
    parts.gate().close();
  }
}
