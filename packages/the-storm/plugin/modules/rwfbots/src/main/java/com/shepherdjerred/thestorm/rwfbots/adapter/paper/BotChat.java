package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChatChannel;
import com.shepherdjerred.thestorm.chat.app.NpcChat;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwf.app.view.Transition;
import com.shepherdjerred.thestorm.rwfbots.app.ChatGate;
import com.shepherdjerred.thestorm.rwfbots.app.ChatMoments;
import com.shepherdjerred.thestorm.rwfbots.app.TeamReport;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkLoop;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatDirector;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatMoment;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatScene;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatSettings;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.SpeechControl;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.Utterance;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.function.Consumer;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.World;
import org.jspecify.annotations.Nullable;

/**
 * Lets the bots talk. Listens to rwf's match transitions, reads them as chat moments, asks one
 * {@link ChatDirector} per match (seeded from the match, alive from its lobby to its end) who says
 * what, and says each line when it is due through chat's {@link NpcChat}: team calls (a plant, a
 * defuse, the last of a team) in Team chat, everything else in Global, either way heard only by the
 * human players in the match world (members and watchers), never Discord or anyone elsewhere, and
 * subject to chat's filters, hidden channels and ignores. A line reads like player chat in its
 * channel's format, with the {@code ✦} bot marker after the name and, once teams exist, a mark in
 * the bot's team colour before it. In the lobby bots greet as they walk in, answer a human who
 * chats there, make small talk and remark on the countdown's last seconds. Every second it offers
 * the director an idle moment and, every {@code flagRefresh}, evaluates the managed Flipt flag off
 * the main thread; the cached answer gates every line, so the flag off, an evaluation failure or no
 * answer yet keeps bots silent. Main thread only.
 */
public final class BotChat implements Consumer<MatchNotification>, BodyActivity {

  static final String MARKER = " ✦";

  /** Shown before a bot's name, in its team's colour, once the match is live. */
  static final String TEAM_MARK = "●";

  private static final Duration IDLE_EVERY = Duration.ofSeconds(1);
  private static final long CHAT_SALT = 0x63686174L;

  /** The countdown's last seconds a bot may remark on. */
  static final Duration COUNTDOWN_CALL = Duration.ofSeconds(10);

  private final Parts parts;
  private final Map<String, String> teamsByName = new HashMap<>();
  private final Map<UUID, Speech> speeches = new HashMap<>();
  private SpeechControl limits = new SpeechControl();
  private Optional<ThinkLoop> thinking = Optional.empty();
  private Optional<org.bukkit.plugin.Plugin> plugin = Optional.empty();

  private record Speech(
      Utterance line,
      Instant starts,
      Instant ends,
      int lifeEpoch,
      Optional<TeamReport> report,
      Optional<org.bukkit.entity.TextDisplay> indicator) {
    Speech withIndicator(org.bukkit.entity.TextDisplay display) {
      return new Speech(line, starts, ends, lifeEpoch, report, Optional.of(display));
    }
  }

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
   * @param worlds the match and lobby worlds, whose human players hear the bots
   * @param npc chat, which checks, routes and delivers each line
   * @param scheduler the main thread
   * @param time the clock
   * @param logger the module logger
   */
  public record Parts(
      ChatSettings settings,
      Duration flagRefresh,
      ChatGate gate,
      Roster roster,
      List<World> worlds,
      NpcChat npc,
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

  /** Wires the live controller after construction, without changing the lobby chat contract. */
  public void compose(ThinkLoop loop, org.bukkit.plugin.Plugin owner) {
    thinking = Optional.of(loop);
    plugin = Optional.of(owner);
  }

  @Override
  public boolean typing(UUID uuid) {
    var speech = speeches.get(uuid);
    if (speech == null) return false;
    var now = parts.time().instant();
    if (!casualOpportunity(speech, now)) {
      cancel(uuid);
      return false;
    }
    return !now.isBefore(speech.starts());
  }

  @Override
  public void cancel(UUID uuid) {
    var speech = speeches.remove(uuid);
    if (speech != null) speech.indicator().ifPresent(org.bukkit.entity.Entity::remove);
  }

  private void clearSpeech() {
    List.copyOf(speeches.keySet()).forEach(this::cancel);
  }

  /** Every body tick, before commands: danger/fuse work cancel typing and reports age out. */
  public void tick(Optional<WorldSnapshot> snapshot) {
    var now = parts.time().instant();
    thinking.ifPresent(loop -> loop.composedCommunication(enabled));
    if (!enabled || closed) {
      clearSpeech();
      return;
    }
    if (snapshot.isPresent()) {
      var world = snapshot.orElseThrow();
      thinking.ifPresent(loop -> loop.drainReports().forEach(report -> report(report, world, now)));
    }
    for (var uuid : List.copyOf(speeches.keySet())) advance(uuid, snapshot, now);
  }

  private void advance(UUID uuid, Optional<WorldSnapshot> snapshot, Instant now) {
    var speech = java.util.Objects.requireNonNull(speeches.get(uuid));
    var body = parts.roster().bodies().entity(uuid);
    if (body.isEmpty()
        || body.orElseThrow().isDead()
        || stale(speech, snapshot)
        || !casualOpportunity(speech, now)) {
      cancel(uuid);
      return;
    }
    if (now.isBefore(speech.starts())) return;
    speech = indicator(speech, body.orElseThrow());
    speeches.put(uuid, speech);
    if (now.isBefore(speech.ends())) return;
    if (limits.deliver(uuid, channel(speech.line()), speech.line().text(), now)
        && show(speech.line())) {
      var completed = speech;
      thinking.ifPresent(loop -> completed.report().ifPresent(loop::delivered));
    }
    cancel(uuid);
  }

  private boolean casualOpportunity(Speech speech, Instant now) {
    if (!nonurgent(speech.line()) || previous == null || previous.phase() != MatchState.Phase.LIVE)
      return true;
    return stationaryOpportunity(speech.line().speaker())
        .orElseGet(() -> now.isBefore(speech.starts()));
  }

  private Optional<Boolean> stationaryOpportunity(UUID speaker) {
    return parts
        .roster()
        .session()
        .flatMap(session -> session.ids().known(speaker))
        .flatMap(id -> thinking.flatMap(loop -> loop.board().of(id)))
        .map(thought -> idleOpportunity(thought.decision()));
  }

  private boolean idleSpeaker(UUID speaker) {
    return !speeches.containsKey(speaker) && stationaryOpportunity(speaker).orElse(false);
  }

  private static boolean nonurgent(Utterance line) {
    return !line.teamOnly()
        && switch (line.moment()) {
          case GREET, TAUNT, LOBBY -> true;
          default -> false;
        };
  }

  static boolean idleOpportunity(
      com.shepherdjerred.thestorm.rwfbots.domain.world.Decision decision) {
    return (decision.option() == com.shepherdjerred.thestorm.rwfbots.domain.world.Option.HOLD_SLOT
            || decision.option()
                == com.shepherdjerred.thestorm.rwfbots.domain.world.Option.HOLD_ANGLE)
        && decision.waypoints().isEmpty()
        && decision.target().isEmpty()
        && decision.ability().isEmpty()
        && decision.routeFailure().isEmpty();
  }

  private Speech indicator(Speech speech, org.bukkit.entity.Player player) {
    if (plugin.isEmpty()) return speech;
    if (speech.indicator().isEmpty()) {
      var display =
          player
              .getWorld()
              .spawn(
                  Places.at(player).add(0, 2.5, 0),
                  org.bukkit.entity.TextDisplay.class,
                  made -> {
                    made.setVisibleByDefault(false);
                    made.setBillboard(org.bukkit.entity.Display.Billboard.CENTER);
                    made.text(
                        net.kyori.adventure.text.Component.text("typing…", NamedTextColor.GRAY));
                    made.setPersistent(false);
                  });
      speech = speech.withIndicator(display);
    }
    var display = speech.indicator().orElseThrow();
    display.teleport(Places.at(player).add(0, 2.5, 0));
    for (var viewer : player.getWorld().getPlayers()) {
      if (indicatorVisible(player, viewer)) viewer.showEntity(plugin.orElseThrow(), display);
      else viewer.hideEntity(plugin.orElseThrow(), display);
    }
    return speech;
  }

  private boolean indicatorVisible(
      org.bukkit.entity.Player speaker, org.bukkit.entity.Player viewer) {
    var state = previous;
    if (state == null
        || speaker.getUniqueId().equals(viewer.getUniqueId())
        || parts.roster().isBot(viewer.getUniqueId())) return false;
    var teammate =
        state
            .combatant(speaker.getUniqueId())
            .flatMap(MatchState.Fighter::team)
            .filter(
                team ->
                    state
                        .combatant(viewer.getUniqueId())
                        .flatMap(MatchState.Fighter::team)
                        .filter(team::equals)
                        .isPresent())
            .isPresent();
    return teammate
        && Places.at(viewer).distanceSquared(Places.at(speaker)) <= 24 * 24
        && viewer.hasLineOfSight(speaker);
  }

  private static Optional<String> channel(Utterance line) {
    return line.teamOnly() ? line.team() : Optional.empty();
  }

  private boolean stale(Speech speech, Optional<WorldSnapshot> snapshot) {
    if (snapshot.isEmpty()) return false;
    var world = snapshot.orElseThrow();
    var session = parts.roster().session();
    if (session.isEmpty()) return true;
    var id = session.orElseThrow().ids().known(speech.line().speaker());
    var self = id.flatMap(world::combatant);
    if (self.isEmpty() || !self.orElseThrow().alive()) return true;
    var me = self.orElseThrow();
    if (speech.lifeEpoch() >= 0
        && thinking.filter(loop -> loop.epoch(me.id()) != speech.lifeEpoch()).isPresent())
      return true;
    var busy =
        thinking
            .flatMap(loop -> loop.board().of(me.id()))
            .map(thought -> thought.decision().option())
            .filter(
                option ->
                    option == com.shepherdjerred.thestorm.rwfbots.domain.world.Option.DEFUSE
                        || option == com.shepherdjerred.thestorm.rwfbots.domain.world.Option.ARM
                        || option
                            == com.shepherdjerred.thestorm.rwfbots.domain.world.Option.HELP_ARM)
            .flatMap(
                option ->
                    thinking
                        .flatMap(loop -> loop.board().of(me.id()))
                        .flatMap(thought -> thought.decision().bomb()))
            .flatMap(world::bomb)
            .filter(
                bomb ->
                    bomb.pos().distance(me.eye())
                        <= com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex.BOMB_REACH)
            .isPresent();
    if (busy
        || parts
            .roster()
            .bot(speech.line().speaker())
            .filter(bot -> bot.shieldUntil() > world.tick())
            .isPresent()) return true;
    if (me.lastHurtTick() >= 0 && world.tick() - me.lastHurtTick() <= 15) return true;
    var danger =
        thinking
            .flatMap(loop -> loop.board().of(me.id()))
            .map(thought -> thought.percept().visible())
            .orElseGet(List::of)
            .stream()
            .anyMatch(other -> other.alive() && other.pos().distance(me.pos()) < 6);
    return danger
        || speech
            .report()
            .filter(
                report ->
                    world.tick() - report.sighting().seenTick() > 120
                        || !report.team().equals(me.team()))
            .isPresent();
  }

  private void report(TeamReport report, WorldSnapshot snapshot, Instant now) {
    var session = parts.roster().session().orElseThrow();
    var uuid = session.ids().uuid(report.sighting().reporter());
    if (uuid.isEmpty()
        || speeches.containsKey(uuid.orElseThrow())
        || snapshot.tick() - report.sighting().seenTick() > 120) return;
    var bot = parts.roster().bot(uuid.orElseThrow());
    if (bot.isEmpty()) return;
    var fighter =
        previous == null
            ? Optional.<MatchState.Fighter>empty()
            : previous.combatant(uuid.orElseThrow());
    var team = fighter.flatMap(MatchState.Fighter::team).map(ChatMoments::teamName);
    if (team.isEmpty()) return;
    var point = report.sighting().pos();
    var text =
        "Enemy near " + Math.round(point.x() / 8) * 8 + ", " + Math.round(point.z() / 8) * 8 + "!";
    var line =
        new Utterance(
            uuid.orElseThrow(),
            bot.orElseThrow().name(),
            team,
            com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines.Moment.ON_LAST_ALIVE,
            text,
            text,
            now);
    queue(line, Optional.of(report));
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
    if (!before.matchId().equals(after.matchId())
        || (before.phase() != after.phase() && after.phase() != MatchState.Phase.COUNTDOWN))
      clearSpeech();
    after.combatants().stream()
        .filter(fighter -> !fighter.alive())
        .filter(
            fighter ->
                before.combatant(fighter.uuid()).filter(MatchState.Fighter::alive).isPresent())
        .forEach(fighter -> cancel(fighter.uuid()));
    var now = parts.time().instant();
    var lines = new ArrayList<Utterance>();
    for (var moment : ChatMoments.of(before, transition)) {
      lines.addAll(director(after, now).on(moment, scene(after), now));
    }
    if (after.phase() == MatchState.Phase.RESETTING) {
      clearSpeech();
      limits = new SpeechControl();
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
    current
        .on(new ChatMoment.Idle(), scene(state), now, this::idleSpeaker)
        .forEach(line -> say(line, now));
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
    if (!now.isAfter(line.at().plusSeconds(4))) queue(line, Optional.empty());
  }

  private void queue(Utterance line, Optional<TeamReport> report) {
    var bot = parts.roster().bot(line.speaker());
    if (!enabled || bot.isEmpty() || speeches.containsKey(line.speaker())) return;
    var now = parts.time().instant();
    if (line.at().isAfter(now.plusSeconds(4))) return;
    var channel = channel(line);
    if (!limits.ready(line.speaker(), channel, line.text(), now)) return;
    var queued =
        speeches.values().stream().filter(speech -> channel(speech.line()).equals(channel)).count();
    if (queued >= limits.remaining(channel, now)) return;
    var starts = now.plus(SpeechControl.reaction(bot.orElseThrow().random()));
    var epoch =
        bot.orElseThrow()
            .profile()
            .flatMap(profile -> thinking.map(loop -> loop.epoch(profile.id())))
            .orElse(-1);
    speeches.put(
        line.speaker(),
        new Speech(
            line,
            starts,
            starts.plus(SpeechControl.typing(line.text(), bot.orElseThrow().random())),
            epoch,
            report,
            Optional.empty()));
  }

  /**
   * Says {@code line} through chat: a team call in Team chat, everything else in Global, heard only
   * by the humans in the match world. Chat applies its filters, hidden channels and ignores; a line
   * it refuses is dropped.
   */
  private boolean show(Utterance line) {
    if (closed || !enabled) {
      return false;
    }
    var audience = new HashSet<UUID>();
    for (var world : parts.worlds()) {
      for (var player : world.getPlayers()) {
        if (!parts.roster().isBot(player.getUniqueId())) {
          audience.add(player.getUniqueId());
        }
      }
    }
    var channel = line.teamOnly() ? ChatChannel.TEAM : ChatChannel.GLOBAL;
    var refused =
        parts
            .npc()
            .say(
                new NpcChat.Line(
                    line.speaker(),
                    line.name() + MARKER,
                    channel,
                    line.text(),
                    prefix(line),
                    audience::contains));
    refused.ifPresent(
        why ->
            parts
                .logger()
                .debug("rwfbots: chat refused {}'s line in {}: {}", line.name(), channel, why));
    return refused.isEmpty();
  }

  /** A mark in the speaker's team colour before the name, once teams exist; none in the lobby. */
  private String prefix(Utterance line) {
    return line.team()
        .map(this::color)
        .map(color -> NamedTextColor.NAMES.keyOrThrow(color))
        .map(name -> "<" + name + ">" + TEAM_MARK + "</" + name + ">")
        .orElse("");
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
    clearSpeech();
    thinking.ifPresent(loop -> loop.composedCommunication(false));
    director = null;
    directorMatch = null;
    parts.gate().close();
  }
}
