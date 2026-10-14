package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.RwfBotsModule;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.BotChat;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.RwfBotsPaper;
import com.shepherdjerred.thestorm.rwfbots.app.DecisionBoard;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.ChatDirector;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.Utterance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** Private main-thread observations of the installed chat service; never advances its state. */
final class ChatStateProbe {
  private ChatStateProbe() {}

  record Gate(boolean enabled, boolean closed, boolean checking, boolean directorPresent) {}

  record Clocks(String now, String refreshDue, @Nullable String idleDue) {}

  record Lifecycle(
      @Nullable UUID observedMatch,
      @Nullable String observedPhase,
      @Nullable UUID sessionMatch,
      @Nullable UUID directorMatch) {}

  record Presence(boolean rostered, boolean nativeBody) {}

  record Identity(UUID uuid, String name, boolean alive, Presence presence) {}

  record Goal(int waypoints, @Nullable Integer target, @Nullable String ability, boolean failed) {}

  record Thought(long tick, int lifeEpoch, String option, Goal goal) {}

  record Lookup(@Nullable Integer id, @Nullable Thought thought) {}

  record Quote(String moment, boolean teamOnly, String text) {}

  record Timing(String starts, String ends, int lifeEpoch) {}

  record Queued(Quote line, Timing timing) {}

  record Speaker(Identity identity, Lookup lookup, @Nullable Queued queued) {}

  record Snapshot(Gate gate, Clocks clocks, Lifecycle lifecycle, List<Speaker> speakers) {}

  static Snapshot capture(TheStormPlugin storm) {
    if (!storm.getServer().isPrimaryThread())
      throw new IllegalStateException("chat inspection requires the main thread");
    var paper = installed(storm);
    var talk = paper.chat().orElseThrow(() -> new IllegalStateException("bot chat not composed"));
    var parts = required(talk, BotChat.class, "parts", BotChat.Parts.class);
    var previous = read(talk, BotChat.class, "previous", MatchState.class);
    var director = read(talk, BotChat.class, "director", ChatDirector.class);
    var session = paper.roster().session();
    var state = storm.service(MatchView.class).current().map(MatchState::of).orElseThrow();
    var observed = previous == null ? null : MatchState.class.cast(previous);
    var clock =
        new Clocks(
            parts.time().instant().toString(),
            required(talk, BotChat.class, "nextCheck", Instant.class).toString(),
            director == null
                ? null
                : required(director, ChatDirector.class, "nextTaunt", Instant.class).toString());
    var lifecycle =
        new Lifecycle(
            observed == null ? null : observed.matchId(),
            observed == null ? null : observed.phase().name(),
            session.map(found -> found.matchId()).orElse(null),
            nullableUuid(talk, "directorMatch"));
    var queued = read(talk, BotChat.class, "speeches", Map.class);
    if (!(queued instanceof Map<?, ?> speeches))
      throw new IllegalStateException("bot chat speeches is not a map");
    var board = paper.loop().board();
    var speakers =
        state.combatants().stream()
            .filter(MatchState.Fighter::bot)
            .map(fighter -> speaker(paper, fighter, board, speeches))
            .toList();
    return new Snapshot(
        new Gate(talk.enabled(), bool(talk, "closed"), bool(talk, "checking"), director != null),
        clock,
        lifecycle,
        speakers);
  }

  private static RwfBotsPaper installed(TheStormPlugin storm) {
    var value = read(storm, TheStormPlugin.class, "enabled", List.class);
    if (!(value instanceof List<?> modules))
      throw new IllegalStateException("installed modules is not a list");
    var bots = modules.stream().filter(RwfBotsModule.class::isInstance).toList();
    if (bots.size() != 1) throw new IllegalStateException("expected one installed rwfbots module");
    return required(bots.getFirst(), RwfBotsModule.class, "paper", RwfBotsPaper.class);
  }

  private static Speaker speaker(
      RwfBotsPaper paper, MatchState.Fighter fighter, DecisionBoard board, Map<?, ?> speeches) {
    var roster = paper.roster();
    var id = roster.session().flatMap(session -> session.ids().known(fighter.uuid()));
    var thought = id.flatMap(board::of).map(found -> thought(found.decision())).orElse(null);
    var identity =
        new Identity(
            fighter.uuid(),
            fighter.name(),
            fighter.alive(),
            new Presence(
                roster.bot(fighter.uuid()).isPresent(),
                roster.bodies().entity(fighter.uuid()).isPresent()));
    return new Speaker(
        identity,
        new Lookup(id.map(found -> found.value()).orElse(null), thought),
        queued(speeches.get(fighter.uuid())));
  }

  private static Thought thought(Decision decision) {
    return new Thought(
        decision.snapshotTick(),
        decision.lifeEpoch(),
        decision.option().name(),
        new Goal(
            decision.waypoints().size(),
            decision.target().map(target -> target.value()).orElse(null),
            decision.ability().orElse(null),
            decision.routeFailure().isPresent()));
  }

  private static @Nullable Queued queued(@Nullable Object speech) {
    if (speech == null) return null;
    if (!speech.getClass().isRecord()
        || !speech.getClass().getName().equals(BotChat.class.getName() + "$Speech"))
      throw new IllegalStateException("bot chat queue contains an unexpected speech type");
    var owner = speech.getClass();
    var line = required(speech, owner, "line", Utterance.class);
    var epoch = read(speech, owner, "lifeEpoch", int.class);
    if (!(epoch instanceof Integer life))
      throw new IllegalStateException("speech life epoch is not an integer");
    return new Queued(
        new Quote(line.moment().name(), line.teamOnly(), line.text()),
        new Timing(
            required(speech, owner, "starts", Instant.class).toString(),
            required(speech, owner, "ends", Instant.class).toString(),
            life));
  }

  private static @Nullable UUID nullableUuid(BotChat talk, String name) {
    var value = read(talk, BotChat.class, name, UUID.class);
    return value == null ? null : UUID.class.cast(value);
  }

  private static boolean bool(BotChat talk, String name) {
    var value = read(talk, BotChat.class, name, boolean.class);
    if (!(value instanceof Boolean flag))
      throw new IllegalStateException("bot chat " + name + " is not a boolean");
    return flag;
  }

  private static <T> T required(Object target, Class<?> owner, String name, Class<T> type) {
    return type.cast(Objects.requireNonNull(read(target, owner, name, type), "missing " + name));
  }

  private static @Nullable Object read(
      Object target, Class<?> owner, String name, Class<?> expected) {
    if (!owner.isInstance(target)) throw new IllegalStateException("unexpected owner for " + name);
    try {
      var field = owner.getDeclaredField(name);
      if (field.getType() != expected || !field.trySetAccessible())
        throw new IllegalStateException("chat inspection field contract changed: " + name);
      return field.get(target);
    } catch (ReflectiveOperationException failure) {
      throw new IllegalStateException("cannot inspect chat field " + name, failure);
    }
  }
}
