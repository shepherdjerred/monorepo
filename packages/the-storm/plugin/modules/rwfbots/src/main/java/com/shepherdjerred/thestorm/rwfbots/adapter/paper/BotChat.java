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
 * {@link ChatDirector} per match (seeded from the match) who says what, and shows each line when it
 * is due to the human players in the match world: members and watchers, never Global, Discord or
 * anyone elsewhere. A line reads like player chat with rwf's dim {@code ✦} bot marker after the
 * name, the name in the bot's team colour. Every second it offers the director an idle taunt and,
 * every {@code flagRefresh}, evaluates the managed Flipt flag off the main thread; the cached
 * answer gates every line, so the flag off, an evaluation failure or no answer yet keeps bots
 * silent. Main thread only.
 */
public final class BotChat implements Consumer<MatchNotification> {

  static final String MARKER = " ✦";
  private static final Duration IDLE_EVERY = Duration.ofSeconds(1);
  private static final long CHAT_SALT = 0x63686174L;

  private final Parts parts;
  private final List<Cancellable> pending = new ArrayList<>();
  private final Map<String, String> teamsByName = new HashMap<>();
  private MatchEvents.@Nullable Subscription subscription;
  private @Nullable Cancellable clock;
  private @Nullable MatchState previous;
  private @Nullable ChatDirector director;
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
      if (moment instanceof ChatMoment.Started) {
        director =
            new ChatDirector(
                parts.settings(),
                new SplittableRandom(MatchSession.seedOf(after.matchId()) ^ CHAT_SALT),
                now);
      }
      var current = director;
      if (current != null) {
        lines.addAll(current.on(moment, scene(after), now));
      }
    }
    if (after.phase() != MatchState.Phase.LIVE && after.phase() != MatchState.Phase.ENDED) {
      director = null;
    }
    lines.forEach(line -> say(line, now));
  }

  /** Once a second: refresh the flag when due and offer an idle taunt during a live match. */
  private void second() {
    var now = parts.time().instant();
    if (!now.isBefore(nextCheck)) {
      refresh();
    }
    var current = director;
    var state = previous;
    if (current == null || state == null || state.phase() != MatchState.Phase.LIVE) {
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
    var message = render(line, color(line.team()));
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
    parts.gate().close();
  }
}
