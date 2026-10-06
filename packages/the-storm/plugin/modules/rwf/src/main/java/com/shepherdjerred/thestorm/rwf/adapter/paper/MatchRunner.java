package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.snapshot.PlayerStates;
import com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.PayoutService;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.Rewinder;
import com.shepherdjerred.thestorm.rwf.domain.lobby.Arrivals;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyStatus;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Notice;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import com.shepherdjerred.thestorm.rwf.domain.match.Vitals;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlotGroup;
import org.jspecify.annotations.Nullable;

/**
 * Runs the one match: feeds events to the {@link RwfMatch} and carries out its effects in order,
 * ticks it twenty times a second, fills it with bots when the countdown starts, keeps the humans
 * rule, settles payouts and recordings when it ends, and publishes the read model and transitions.
 * Events raised while effects are being applied wait their turn. A showcase is a match an operator
 * fills with bots alone: the humans rule is off for it and no human may join it. Main thread only.
 */
final class MatchRunner implements MatchView, MatchEvents {

  /** How often the Rewind trail is sampled: every fifth tick, four times a second. */
  static final int TRAIL_EVERY_TICKS = 5;

  /** How often holograms and the sidebar are redrawn. */
  static final int DISPLAY_EVERY_TICKS = 5;

  /**
   * Drafted bots arrive in the first half of the countdown, leaving time for admission and kit
   * choice.
   */
  static final double ARRIVAL_SHARE = 0.5;

  /** Mixed into the match seed for the arrival schedule, so it differs from the other rolls. */
  private static final long ARRIVAL_SALT = 0x6C6F6262795F696EL;

  /**
   * A drafted bot on its way into the lobby.
   *
   * @param bot the bot
   * @param at when it walks in
   */
  private record Arrival(CombatantId.Bot bot, Instant at) {}

  /**
   * What the runner works with.
   *
   * @param context the shared server services
   * @param config the module settings
   * @param snapshots human belongings
   * @param kits kit items
   * @param boards the match scoreboard
   * @param bombs bomb entities and holograms
   * @param maps every map in the world
   * @param bots the bot roster, when provided
   * @param combat hit bookkeeping
   * @param payouts the payout use case
   * @param store finished matches
   * @param recordings match recordings
   * @param lobby the lobby room
   * @param hud the countdown boss bar and titles
   * @param displays the lobby's rules, match board and kit alcoves
   * @param menus opens the kit menu
   */
  record Parts(
      PaperContext context,
      RwfConfig config,
      Snapshots snapshots,
      KitFactory kits,
      Scoreboards boards,
      BombMarkers bombs,
      List<MapWorld> maps,
      Bots bots,
      CombatTracker combat,
      PayoutService payouts,
      MatchStore store,
      Recordings recordings,
      LobbyRoom lobby,
      LobbyHud hud,
      LobbyDisplays displays,
      KitMenu.Opener menus) {}

  /** A member's running tally. */
  private static final class Tally {
    int kills;
    int deaths;
  }

  private final Parts parts;
  private final Effects effects = new Effects();
  private final ArrayDeque<MatchEvent> waiting = new ArrayDeque<>();
  private final List<Consumer<MatchNotification>> listeners = new ArrayList<>();
  private final Map<CombatantId, Rewinder> rewinders = new HashMap<>();
  private final Map<CombatantId, Tally> tallies = new HashMap<>();
  private final Map<CombatantId, Long> pendingPay = new HashMap<>();
  private final Set<UUID> awaitingSpectate = new HashSet<>();
  private final Set<UUID> poisoned = new HashSet<>();
  private final ArrayDeque<Arrival> arriving = new ArrayDeque<>();
  private RwfMatch match;
  private @Nullable MapWorld current;
  private boolean applying;
  private boolean ready;
  private long ticks;
  private @Nullable Instant humansGoneSince;
  private @Nullable Instant liveAt;
  private @Nullable MatchSnapshot cached;
  private @Nullable RwfMatch cachedFor;
  private OptionalInt showcase = OptionalInt.empty();
  private @Nullable UUID keepingSnapshot;
  private int lastTitle;

  MatchRunner(Parts parts) {
    this.parts = parts;
    this.match =
        RwfMatch.open(
            parts.config().matchSettings(), UUID.randomUUID(), parts.context().random().nextLong());
  }

  // ---- read side -------------------------------------------------------------------------------

  RwfMatch match() {
    return match;
  }

  boolean ready() {
    return ready;
  }

  boolean live() {
    return match.phase() instanceof Phase.Live;
  }

  Instant now() {
    return parts.context().time().instant();
  }

  /** The map the match plays on; only absent before the maps are ready. */
  MapWorld currentMap() {
    var map = current;
    if (map == null) {
      throw new IllegalStateException("no map is chosen");
    }
    return map;
  }

  Optional<MapWorld> mapAt(Location location) {
    return parts.maps().stream().filter(map -> map.contains(location)).findFirst();
  }

  Optional<Combatant> memberOf(UUID entity) {
    return match.members().stream().filter(m -> m.id().uuid().equals(entity)).findFirst();
  }

  Optional<Combatant> member(CombatantId id) {
    return match.member(id);
  }

  /** Whether {@code entity} is a living member of a live match. */
  boolean fighting(UUID entity) {
    return live() && memberOf(entity).filter(Combatant::alive).isPresent();
  }

  Optional<Player> entity(CombatantId id) {
    return switch (id) {
      case CombatantId.Human human ->
          Optional.ofNullable(parts.context().server().getPlayer(human.uuid()));
      case CombatantId.Bot bot -> parts.bots().entity(bot);
    };
  }

  /** Whether {@code entity} is a roster bot, whatever match state it is in. */
  boolean isBot(UUID entity) {
    return parts.bots().isBot(entity);
  }

  int humans() {
    return (int) match.members().stream().filter(m -> !m.id().isBot()).count();
  }

  /** Whether this match is a bots-only showcase. */
  boolean showcase() {
    return showcase.isPresent();
  }

  /**
   * The entities a watcher can follow, in join order: the living fighters once the match has
   * started, or everyone in the lobby before it.
   */
  List<Player> followable() {
    var begun = started(match.phase());
    var out = new ArrayList<Player>();
    for (var member : match.members()) {
      if (!begun || member.alive()) {
        entity(member.id()).ifPresent(out::add);
      }
    }
    return out;
  }

  Optional<Rewinder> rewinder(CombatantId id) {
    return Optional.ofNullable(rewinders.get(id));
  }

  void rewinder(CombatantId id, Rewinder rewinder) {
    rewinders.put(id, rewinder);
  }

  boolean awaitsSpectate(UUID player) {
    return awaitingSpectate.contains(player);
  }

  boolean poisoned(UUID player) {
    return poisoned.contains(player);
  }

  @Override
  public Optional<MatchSnapshot> current() {
    if (!ready) {
      return Optional.empty();
    }
    var snapshot = cached;
    if (snapshot == null || !match.equals(cachedFor)) {
      snapshot = MatchSnapshot.of(match, now());
      cached = snapshot;
      cachedFor = match;
    }
    return Optional.of(snapshot);
  }

  @Override
  public Subscription subscribe(Consumer<MatchNotification> listener) {
    listeners.add(listener);
    return () -> listeners.remove(listener);
  }

  // ---- write side ------------------------------------------------------------------------------

  /** The maps are pasted: the first map is chosen and the lobby opens. */
  void open(MapWorld first) {
    ready = true;
    choose(first);
  }

  private void choose(MapWorld map) {
    current = map;
    var refused = handle(new MatchEvent.MapChosen(map.definition()));
    if (refused.isPresent()) {
      throw new IllegalStateException("the lobby refused its map: " + refused.orElseThrow());
    }
  }

  /** Applies {@code event}, or returns why it was refused. */
  Optional<MatchError> handle(MatchEvent event) {
    if (applying) {
      waiting.add(event);
      return Optional.empty();
    }
    var before = match;
    var refusal =
        switch (match.on(event)) {
          case Result.Err<RwfMatch.Step, MatchError>(var error) -> Optional.of(error);
          case Result.Ok<RwfMatch.Step, MatchError>(var step) -> {
            match = step.match();
            applying = true;
            try {
              // A step that starts the match may also end it (a team with nobody alive): the
              // live world (bomb markers, recording, teams) must exist before its effects run.
              if (before.phase().preGame() && started(match.phase())) {
                wentLive();
              }
              for (var effect : step.effects()) {
                applyGuarded(effect);
              }
              afterStep(before, event);
            } finally {
              applying = false;
            }
            notifyListeners(event, step.effects());
            yield Optional.<MatchError>empty();
          }
        };
    while (!waiting.isEmpty()) {
      handle(waiting.poll());
    }
    return refusal;
  }

  /** Whether {@code phase} is one a match reaches only by going live first. */
  private static boolean started(Phase phase) {
    return phase instanceof Phase.Live || phase instanceof Phase.Ended;
  }

  /**
   * Carries out one effect; one that fails is logged and the rest still run, so a broken block or
   * entity can never strand the match in a phase it cannot leave.
   */
  private void applyGuarded(MatchEffect effect) {
    try {
      effects.apply(effect);
    } catch (RuntimeException failure) {
      parts.context().logger().error("rwf effect {} failed; carrying on", effect, failure);
    }
  }

  private void notifyListeners(MatchEvent event, List<MatchEffect> applied) {
    if (listeners.isEmpty()) {
      return;
    }
    var notification = new MatchNotification(event, applied, current().orElseThrow());
    for (var listener : List.copyOf(listeners)) {
      parts.context().guarded("notifying a match listener", () -> listener.accept(notification));
    }
  }

  /**
   * Phase changes the adapter acts on after the effects of the step that made them. Going live is
   * handled before the effects, in {@link #handle}.
   */
  private void afterStep(RwfMatch before, MatchEvent event) {
    var was = before.phase();
    var is = match.phase();
    if (was instanceof Phase.Lobby && is instanceof Phase.Countdown) {
      fillWithBots();
    }
    if (is instanceof Phase.Ended ended && !(was instanceof Phase.Ended)) {
      ended(ended);
    }
    if (was instanceof Phase.Live && is instanceof Phase.Resetting) {
      stopped(before, event);
    }
    if (is instanceof Phase.Lobby && was instanceof Phase.Resetting) {
      nextMap();
    }
  }

  /**
   * The countdown started: bots are drafted now, to fill the match up to its target, and walk into
   * the lobby one by one over the first part of the countdown.
   */
  private void fillWithBots() {
    var target = showcase.orElse(parts.config().match().targetCombatants());
    var drafted = parts.bots().fill(match.matchId(), target - match.members().size());
    var now = now();
    var budget =
        match.phase() instanceof Phase.Countdown countdown
            ? Duration.ofMillis(
                Math.round(Duration.between(now, countdown.startsAt()).toMillis() * ARRIVAL_SHARE))
            : Duration.ZERO;
    var offsets = Arrivals.offsets(drafted.size(), match.seed() ^ ARRIVAL_SALT, budget);
    for (var i = 0; i < drafted.size(); i++) {
      arriving.add(new Arrival(drafted.get(i), now.plus(offsets.get(i))));
    }
  }

  /** Bots whose time has come walk into the lobby, while the countdown runs. */
  private void arrive(Instant now) {
    if (arriving.isEmpty()) {
      return;
    }
    if (!(match.phase() instanceof Phase.Countdown)) {
      releaseArrivals();
      return;
    }
    while (!arriving.isEmpty() && !arriving.peek().at().isAfter(now)) {
      var _ = joinBot(arriving.poll().bot());
    }
  }

  /** Drafted bots that have not walked in yet go back to the roster: the countdown stopped. */
  private void releaseArrivals() {
    while (!arriving.isEmpty()) {
      parts.bots().despawn(arriving.poll().bot());
    }
  }

  /** How many drafted bots are still on their way in. */
  int arriving() {
    return arriving.size();
  }

  /** Up to {@code count} bots join the lobby now. Returns how many did. */
  private int joinBots(int count) {
    var joined = 0;
    for (var bot : parts.bots().fill(match.matchId(), count)) {
      if (joinBot(bot)) {
        joined++;
      }
    }
    return joined;
  }

  /** {@code bot} appears at the lobby spawn and joins; whether it did. */
  private boolean joinBot(CombatantId.Bot bot) {
    var spawned = parts.bots().spawn(bot, lobby());
    if (spawned.isEmpty()) {
      parts.context().logger().error("Bot {} did not spawn; skipping it", bot);
      return false;
    }
    if (handle(new MatchEvent.Join(bot, spawned.orElseThrow().getName(), now())).isEmpty()) {
      return true;
    }
    parts.bots().despawn(bot);
    return false;
  }

  private void wentLive() {
    // The domain stamped the start with the event's instant; a fresh clock read here would land
    // after an end decided in the same step and the match row would reject it.
    liveAt = match.phase() instanceof Phase.Live live ? live.startedAt() : now();
    humansGoneSince = null;
    tallies.clear();
    pendingPay.clear();
    poisoned.clear();
    releaseArrivals();
    parts.hud().hideAll();
    humanEntities().forEach(KitMenu::close);
    parts.hud().fight(humanEntities());
    parts.bombs().place(currentMap().definition());
    parts.recordings().start(match, currentMap().definition(), now());
    for (var member : match.members()) {
      tallies.put(member.id(), new Tally());
      if (member.kit().filter(KitBook.REWIND.id()::equals).isPresent()) {
        rewinders.put(member.id(), Rewinder.start(now()));
      }
      entity(member.id())
          .ifPresent(
              player ->
                  parts.boards().assign(player, member.team().orElseThrow(), member.id().isBot()));
      parts.recordings().event(now(), "joined", member.id(), member.team().orElseThrow().name());
    }
  }

  /** The match ended with a result: settle payouts, close the recording, write the match. */
  private void ended(Phase.Ended ended) {
    var rows = new ArrayList<MatchStore.PlayerRow>();
    var all = new ArrayList<>(match.members());
    all.addAll(match.departed());
    for (var member : all) {
      if (member.id().isBot()) {
        continue;
      }
      var credits = pendingPay.getOrDefault(member.id(), 0L);
      var won = ended.outcome().winner().filter(team -> member.onTeam(team)).isPresent();
      rows.add(playerRow(member, won, credits));
    }
    var row =
        new MatchStore.MatchRow(
            match.matchId(),
            currentMap().id(),
            liveAtOr(ended.at()),
            ended.at(),
            ended.outcome().winner(),
            (int) all.stream().filter(m -> !m.id().isBot()).count(),
            (int) all.stream().filter(m -> m.id().isBot()).count());
    settle(row, rows);
    var reason =
        switch (ended.outcome()) {
          case Outcome.Winner _ -> RecordEnd.Reason.LAST_TEAM_STANDING;
          case Outcome.Draw _ -> RecordEnd.Reason.DRAW;
          case Outcome.Stopped _ -> RecordEnd.Reason.STOPPED;
        };
    closeRecording(ended.outcome().winner(), reason);
  }

  private MatchStore.PlayerRow playerRow(Combatant member, boolean won, long credits) {
    var tally = tallies.getOrDefault(member.id(), new Tally());
    var outcome =
        member.leftAt().isPresent() && member.diedAt().isEmpty()
            ? MatchStore.Outcome.LEFT
            : won ? MatchStore.Outcome.WIN : MatchStore.Outcome.LOSE;
    return new MatchStore.PlayerRow(
        match.matchId(),
        member.id().uuid(),
        member.team().orElseThrow(),
        member.kit().orElseThrow(),
        tally.kills,
        tally.deaths,
        outcome,
        credits,
        credits > 0 ? MatchStore.PayoutStatus.PENDING : MatchStore.PayoutStatus.NONE,
        0);
  }

  /** A live match was stopped (admin, no humans, disable): no payout, a stopped record. */
  private void stopped(RwfMatch before, MatchEvent event) {
    var live = liveAt;
    if (live == null) {
      return;
    }
    var all = new ArrayList<>(before.members());
    all.addAll(before.departed());
    var rows = new ArrayList<MatchStore.PlayerRow>();
    for (var member : all) {
      if (!member.id().isBot()) {
        rows.add(playerRow(member, false, 0).withOutcome(MatchStore.Outcome.STOPPED));
      }
    }
    settle(
        new MatchStore.MatchRow(
            match.matchId(),
            currentMap().id(),
            live,
            now(),
            Optional.empty(),
            rows.size(),
            (int) all.stream().filter(m -> m.id().isBot()).count()),
        rows);
    closeRecording(Optional.empty(), RecordEnd.Reason.STOPPED);
    parts.context().logger().info("rwf match {} stopped by {}", match.matchId(), event);
  }

  private void settle(MatchStore.MatchRow row, List<MatchStore.PlayerRow> rows) {
    parts
        .context()
        .onMain(
            parts.payouts().settle(row, rows),
            paid -> {
              for (var payment : paid) {
                var player = parts.context().server().getPlayer(payment.player());
                if (player != null && payment.paid() < payment.owed()) {
                  Texts.info(
                      player,
                      "You reached today's match earnings cap; "
                          + payment.paid()
                          + " of "
                          + payment.owed()
                          + " credits were paid.");
                }
              }
            },
            "settle rwf match " + row.matchId());
  }

  private void closeRecording(Optional<TeamColor> winner, RecordEnd.Reason reason) {
    var matchId = match.matchId();
    parts
        .recordings()
        .end(now(), winner, reason, pendingPay)
        .ifPresent(
            summary ->
                parts
                    .context()
                    .onMain(
                        summary.thenCompose(s -> parts.store().recordingFinished(matchId, s)),
                        ignored -> {},
                        "finish the recording of rwf match " + matchId));
    liveAt = null;
  }

  private void nextMap() {
    rewinders.clear();
    tallies.clear();
    pendingPay.clear();
    poisoned.clear();
    awaitingSpectate.clear();
    showcase = OptionalInt.empty();
    parts.combat().clear();
    parts.boards().reset();
    parts.bombs().clear();
    parts.hud().hideAll();
    match =
        RwfMatch.open(
            parts.config().matchSettings(), UUID.randomUUID(), parts.context().random().nextLong());
    var maps = parts.maps();
    choose(maps.get(parts.context().random().nextInt(maps.size())));
  }

  private Instant liveAtOr(Instant fallback) {
    return startedAtFor(liveAt, fallback);
  }

  /** The row's start: the live instant, or {@code endedAt} when the match never (quite) started. */
  static Instant startedAtFor(@Nullable Instant liveAt, Instant endedAt) {
    return liveAt == null || liveAt.isAfter(endedAt) ? endedAt : liveAt;
  }

  /** The load test: {@code count} bots join the lobby now. Returns how many did. */
  int loadTest(int count) {
    return joinBots(count);
  }

  /**
   * Starts a bots-only showcase of {@code count} combatants from an open lobby with no humans in
   * it, or returns why not. It then runs as any match would, without the humans rule.
   */
  Optional<String> startShowcase(int count) {
    if (!ready) {
      return Optional.of("The match is still being prepared; try again in a moment.");
    }
    if (parts.bots().roster().isEmpty()) {
      return Optional.of("No bot roster is provided; enable the rwfbots module.");
    }
    if (showcase.isPresent()) {
      return Optional.of("A showcase is already running.");
    }
    if (humans() > 0) {
      return Optional.of("Players are in the match; a showcase needs a lobby without them.");
    }
    if (!(match.phase() instanceof Phase.Lobby)) {
      return Optional.of("A match is under way; start the showcase from the next lobby.");
    }
    showcase = OptionalInt.of(count);
    joinBots(count - match.members().size());
    if (match.members().isEmpty()) {
      showcase = OptionalInt.empty();
      return Optional.of("No bot could be spawned for the showcase; see the log.");
    }
    parts.context().logger().info("rwf match {} is a showcase of {}", match.matchId(), count);
    return Optional.empty();
  }

  /** The match is stopping for good (disable): restore everyone, despawn bots. */
  void stop() {
    if (!(match.phase() instanceof Phase.Resetting)) {
      handle(new MatchEvent.Stop());
    }
    releaseArrivals();
    parts.hud().hideAll();
    ready = false;
  }

  // ---- the clock -------------------------------------------------------------------------------

  /** One server tick. */
  void tick() {
    ticks++;
    if (!ready) {
      return;
    }
    var now = now();
    keepHumansRule(now);
    arrive(now);
    handle(new MatchEvent.Tick(now, vitals()));
    if (live()) {
      liveTick(now);
    } else if (match.phase().preGame()) {
      lobbyTick(now);
    }
    if (ticks % DISPLAY_EVERY_TICKS == 0) {
      current().ifPresent(parts.boards()::render);
      var status = LobbyStatus.of(match, now);
      parts.hud().update(status);
      parts.displays().update(status);
    }
  }

  /**
   * Before the start: members who leave the room (falling below its floor, say) are put back at its
   * spawn, and the last five seconds of the countdown are shown as titles.
   */
  private void lobbyTick(Instant now) {
    for (var member : match.members()) {
      entity(member.id())
          .filter(player -> !player.isDead() && !parts.lobby().contains(Places.at(player)))
          .ifPresent(player -> player.teleport(lobby()));
    }
    var status = LobbyStatus.of(match, now);
    var seconds = status.stage() == LobbyStatus.Stage.COUNTDOWN ? status.secondsLeft() : 0;
    if (seconds != lastTitle && seconds > 0) {
      parts.hud().countdown(humanEntities(), seconds);
    }
    lastTitle = seconds;
  }

  /** The online human members. */
  private List<Player> humanEntities() {
    var out = new ArrayList<Player>();
    for (var member : match.members()) {
      if (!member.id().isBot()) {
        entity(member.id()).ifPresent(out::add);
      }
    }
    return out;
  }

  /**
   * Bots never keep a countdown alive, and a live match with no humans is stopped unpaid; a
   * showcase has no humans by design. Watchers are not members, so they never count.
   */
  private void keepHumansRule(Instant now) {
    if (showcase.isPresent()) {
      humansGoneSince = null;
      return;
    }
    var minHumans = parts.config().match().minHumans();
    if (match.phase() instanceof Phase.Countdown && humans() < minHumans) {
      releaseArrivals();
      for (var member : match.members()) {
        if (member.id().isBot()) {
          handle(new MatchEvent.Leave(member.id(), now));
        }
      }
      return;
    }
    if (!live()) {
      humansGoneSince = null;
      return;
    }
    if (humans() > 0) {
      humansGoneSince = null;
      return;
    }
    if (humansGoneSince == null) {
      humansGoneSince = now;
    } else if (!now.isBefore(humansGoneSince.plus(parts.config().match().noHumansAbort()))) {
      parts
          .context()
          .logger()
          .info(
              "rwf match {} has had no humans for {}; stopping",
              match.matchId(),
              parts.config().match().noHumansAbort());
      handle(new MatchEvent.Stop());
    }
  }

  private Map<CombatantId, Vitals> vitals() {
    var vitals = new HashMap<CombatantId, Vitals>();
    for (var member : match.members()) {
      if (!member.alive()) {
        continue;
      }
      var entity = entity(member.id());
      if (entity.isEmpty()) {
        // A bot whose entity vanished, or a human the quit event has not reached yet.
        handle(new MatchEvent.Disconnect(member.id(), now()));
        continue;
      }
      var player = entity.orElseThrow();
      vitals.put(member.id(), new Vitals(Places.vec(Places.at(player)), maxHealth(player)));
    }
    return vitals;
  }

  private void liveTick(Instant now) {
    var border = currentMap().definition().border();
    for (var member : match.members()) {
      if (!member.alive()) {
        continue;
      }
      var entity = entity(member.id());
      if (entity.isEmpty()) {
        continue;
      }
      var player = entity.orElseThrow();
      keepInside(player, border);
      parts.recordings().sample(now, ticks, member, player);
      if (ticks % TRAIL_EVERY_TICKS == 0) {
        sampleTrail(member.id(), player, now);
      }
    }
    if (ticks % DISPLAY_EVERY_TICKS == 0) {
      current().ifPresent(parts.bombs()::update);
    }
  }

  /** A fighter outside the border is moved to the nearest point inside, as Red Warfare did. */
  private void keepInside(Player player, Cuboid border) {
    var at = Places.at(player);
    if (!border.contains(Places.vec(at))) {
      var inside = border.clamp(Places.vec(at));
      var target = Places.location(parts.context().world(), inside);
      target.setYaw(at.getYaw());
      target.setPitch(at.getPitch());
      player.teleport(target);
    }
  }

  private void sampleTrail(CombatantId id, Player player, Instant now) {
    var rewinder = rewinders.get(id);
    if (rewinder == null) {
      return;
    }
    var feet = Places.at(player);
    var below = feet.getBlock().getRelative(BlockFace.DOWN);
    var standing = feet.getBlock().getType();
    var safe =
        below.getType().isSolid()
            && !standing.isSolid()
            && standing != Material.LAVA
            && standing != Material.FIRE
            && standing != Material.SOUL_FIRE
            && player.getFireTicks() <= 0;
    if (safe) {
      rewinders.put(id, rewinder.track(Places.vec(feet), now));
    }
  }

  // ---- things players do -----------------------------------------------------------------------

  /** A player asks to join: admission checks, then the match decides. */
  Optional<String> admit(Player player) {
    var refusal = admission(player).or(() -> snapshotRefusal(player));
    if (refusal.isPresent()) {
      return refusal;
    }
    return handle(new MatchEvent.Join(human(player), player.getName(), now())).map(Texts::describe);
  }

  /**
   * A watcher asks to join: the snapshot taken when they started watching already holds their
   * belongings, so it is kept and no new one is taken.
   */
  Optional<String> admitWatcher(Player player) {
    var refusal = admission(player);
    if (refusal.isPresent()) {
      return refusal;
    }
    keepingSnapshot = player.getUniqueId();
    try {
      return handle(new MatchEvent.Join(human(player), player.getName(), now()))
          .map(Texts::describe);
    } finally {
      keepingSnapshot = null;
    }
  }

  private static CombatantId human(Player player) {
    return new CombatantId.Human(player.getUniqueId());
  }

  private Optional<String> admission(Player player) {
    if (!ready) {
      return Optional.of("The match is still being prepared; try again in a moment.");
    }
    if (memberOf(player.getUniqueId()).isPresent()) {
      return Optional.of(Texts.describe(MatchError.ALREADY_JOINED));
    }
    if (showcase.isPresent()) {
      return Optional.of("This match is a bot showcase; watch it with /rwf spectate.");
    }
    return Optional.empty();
  }

  /** Why {@code player} may not have a snapshot taken now, as they should read it. */
  Optional<String> snapshotRefusal(Player player) {
    return parts
        .snapshots()
        .refusal(player.getUniqueId())
        .map(
            refusal ->
                switch (refusal) {
                  case NOT_LOADED -> "The match is still starting up; try again in a moment.";
                  case CLEANUP_PENDING ->
                      "Your restored belongings must be saved before another match. Reconnect to"
                          + " finish recovery.";
                  case RESTORE_PENDING -> {
                    parts.snapshots().recoverWhileOnline(player);
                    yield "Your belongings from your last match were restored first; try again.";
                  }
                });
  }

  /** A member right-clicked a bomb while holding the fuse. */
  Optional<MatchError> clickBomb(CombatantId id, String bombId) {
    return handle(new MatchEvent.BombClicked(id, bombId, now()));
  }

  /**
   * A member died in the world. A player NPC can raise more than one death event for a single
   * death, so only the first death of a living member counts. {@code killer} is the attacker's
   * entity UUID: bots are not online players, so they cannot be looked up as players.
   */
  void died(Player player, Optional<UUID> killer, AttackType cause) {
    var victim = memberOf(player.getUniqueId());
    if (victim.isEmpty() || !victim.orElseThrow().alive()) {
      return;
    }
    var killerId = killer.flatMap(this::memberOf).map(Combatant::id);
    tallies.computeIfAbsent(victim.orElseThrow().id(), ignored -> new Tally()).deaths++;
    killerId.ifPresent(k -> tallies.computeIfAbsent(k, ignored -> new Tally()).kills++);
    parts
        .recordings()
        .event(
            now(),
            "died",
            victim.orElseThrow().id(),
            killerId.flatMap(parts.recordings()::pseudonym).orElse("-") + " " + cause.name());
    handle(new MatchEvent.Died(victim.orElseThrow().id(), killerId, cause, now()));
  }

  /** A dead member respawned: they watch from the spectator point. */
  void respawned(Player player) {
    if (awaitingSpectate.remove(player.getUniqueId())) {
      spectate(player, currentMap().definition().spectatorPoint());
    }
  }

  /** Whether {@code player} is a member waiting for the match to start. */
  boolean waiting(UUID player) {
    return match.phase().preGame() && memberOf(player).isPresent();
  }

  /**
   * A member died before the start and respawned in the lobby: they are made ready again, with the
   * kit they picked.
   */
  void respawnedInLobby(Player player) {
    var member = memberOf(player.getUniqueId());
    if (member.isEmpty() || !match.phase().preGame()) {
      return;
    }
    effects.enterLobby(member.orElseThrow().id());
    member.orElseThrow().kit().ifPresent(kit -> effects.equip(member.orElseThrow().id(), kit));
  }

  /** {@code player} picks {@code kit}, as {@code /rwf kit} and the kit menu do; why not, if not. */
  Optional<String> pickKit(Player player, String kit) {
    var member = memberOf(player.getUniqueId());
    if (member.isEmpty()) {
      return Optional.of(Texts.describe(MatchError.NOT_A_MEMBER));
    }
    return handle(new MatchEvent.PickKit(member.orElseThrow().id(), kit)).map(Texts::describe);
  }

  /**
   * {@code player} leaves the match, as {@code /rwf leave} and the leave item do; why not, if not.
   */
  Optional<String> leave(Player player) {
    var member = memberOf(player.getUniqueId());
    if (member.isEmpty()) {
      return Optional.of(Texts.describe(MatchError.NOT_A_MEMBER));
    }
    return handle(new MatchEvent.Leave(member.orElseThrow().id(), now())).map(Texts::describe);
  }

  /** Opens the kit menu for a member waiting for the start, marking the kit they picked. */
  Optional<String> openKitMenu(Player player) {
    var member = memberOf(player.getUniqueId());
    if (member.isEmpty()) {
      return Optional.of(Texts.describe(MatchError.NOT_A_MEMBER));
    }
    if (!match.phase().preGame()) {
      return Optional.of(Texts.describe(MatchError.NOT_PRE_GAME));
    }
    var _ = parts.menus().open(player, member.orElseThrow().kit());
    return Optional.empty();
  }

  private void spectate(Player player, Spawn at) {
    PlayerStates.wipe(player, GameMode.SPECTATOR);
    player.teleport(Places.location(parts.context().world(), at));
  }

  Location lobby() {
    return parts.lobby().spawn();
  }

  LobbyRoom lobbyRoom() {
    return parts.lobby();
  }

  Location spectatorPoint() {
    var map = current;
    var spawn =
        map == null ? parts.config().spectator().toSpawn() : map.definition().spectatorPoint();
    return Places.location(parts.context().world(), spawn);
  }

  /** Where a watcher stands: the map's spectator point, or the lobby before any map is chosen. */
  Location watchPoint() {
    var map = current;
    return map == null
        ? lobby()
        : Places.location(parts.context().world(), map.definition().spectatorPoint());
  }

  /** Gives {@code player} the match's attack-speed modifier, so the 1.9 cooldown never applies. */
  static void addAttackSpeed(Player player) {
    var attribute = player.getAttribute(Attribute.ATTACK_SPEED);
    if (attribute == null) {
      // A real player always carries attack speed; a bot entity may need it registered.
      player.registerAttribute(Attribute.ATTACK_SPEED);
      attribute = player.getAttribute(Attribute.ATTACK_SPEED);
    }
    if (attribute == null) {
      throw new IllegalStateException(
          "attack speed could not be registered on " + player.getName());
    }
    attribute.removeModifier(Keys.ATTACK_SPEED);
    attribute.addModifier(
        new AttributeModifier(
            Keys.ATTACK_SPEED,
            CombatRules.ATTACK_SPEED_MODIFIER,
            AttributeModifier.Operation.ADD_NUMBER,
            EquipmentSlotGroup.ANY));
  }

  static void removeAttackSpeed(Player player) {
    var attribute = player.getAttribute(Attribute.ATTACK_SPEED);
    if (attribute != null) {
      attribute.removeModifier(Keys.ATTACK_SPEED);
    }
  }

  private static double maxHealth(Player player) {
    var attribute = player.getAttribute(Attribute.MAX_HEALTH);
    if (attribute == null) {
      throw new IllegalStateException("players always have max health");
    }
    return attribute.getValue();
  }

  // ---- effects ---------------------------------------------------------------------------------

  /** Carries out one {@link MatchEffect}. */
  private final class Effects {

    void apply(MatchEffect effect) {
      if (!applyToCombatant(effect)) {
        applyToWorld(effect);
      }
    }

    /** Effects aimed at one or more combatants; false if {@code effect} is not one of them. */
    private boolean applyToCombatant(MatchEffect effect) {
      switch (effect) {
        case MatchEffect.CaptureSnapshot capture -> capture(capture.id());
        case MatchEffect.Restore restore -> restore(restore.id());
        case MatchEffect.EnterLobby enter -> enterLobby(enter.id());
        case MatchEffect.Spectate spectate -> spectate(spectate);
        case MatchEffect.Teleport teleport ->
            withEntity(
                teleport.id(),
                player -> player.teleport(Places.location(parts.context().world(), teleport.to())));
        case MatchEffect.Equip equip -> equip(equip.id(), equip.kitId());
        case MatchEffect.GiveFuse fuse ->
            withEntity(fuse.id(), player -> parts.kits().giveFuse(player, fuse.bonus()));
        case MatchEffect.Tell tell ->
            tell.to().forEach(id -> withEntity(id, player -> Texts.notice(player, tell.notice())));
        case MatchEffect.Sound sound -> sound(sound);
        case MatchEffect.Kill kill -> kill(kill);
        case MatchEffect.PoisonDamage poison -> poison(poison);
        case MatchEffect.StripFood strip ->
            strip.from().forEach(id -> withEntity(id, Effects::stripFood));
        case MatchEffect.Pay pay -> pendingPay.merge(pay.id(), pay.credits(), Long::sum);
        case MatchEffect.RecordStat stat ->
            parts.recordings().event(now(), "stat", stat.id(), stat.stat());
        default -> {
          return false;
        }
      }
      return true;
    }

    /** Effects on the world and the whole match. */
    private void applyToWorld(MatchEffect effect) {
      switch (effect) {
        case MatchEffect.Announce announce -> announce(announce);
        case MatchEffect.SoundAt sound ->
            Sounds.play(
                parts.context().world(),
                Places.center(parts.context().world(), sound.at()),
                sound.cue());
        case MatchEffect.SetTime time -> parts.context().world().setTime(time.ticks());
        case MatchEffect.BombArmed armed -> bomb("armed", armed.bombId(), parts.bombs()::arm);
        case MatchEffect.BombRestored restored ->
            bomb("defused", restored.bombId(), parts.bombs()::restore);
        case MatchEffect.BombRemoved removed ->
            bomb("removed", removed.bombId(), parts.bombs()::remove);
        case MatchEffect.Explode explode ->
            bomb("exploded", explode.bombId(), parts.bombs()::explode);
        case MatchEffect.Crater crater -> currentMap().crater(crater.center(), crater.radius());
        case MatchEffect.RevertCraters _ -> revert();
        default -> throw new IllegalStateException("unhandled effect " + effect);
      }
    }

    /**
     * Gives {@code id} the kit; a human still waiting for the start also gets the lobby's selector
     * and leave item back, which equipping takes away.
     */
    void equip(CombatantId id, String kitId) {
      withEntity(
          id,
          player -> {
            parts.kits().equip(player, parts.kits().require(kitId));
            if (!id.isBot() && match.phase().preGame()) {
              parts.kits().giveLobbyItems(player);
            }
          });
    }

    private void withEntity(CombatantId id, Consumer<Player> action) {
      entity(id).ifPresent(action);
    }

    private void capture(CombatantId id) {
      if (!(id instanceof CombatantId.Human human) || human.uuid().equals(keepingSnapshot)) {
        // Bots have no belongings; a joining watcher keeps the snapshot they watched under.
        return;
      }
      var player = parts.context().server().getPlayer(human.uuid());
      if (player == null) {
        handle(new MatchEvent.Leave(id, now()));
        return;
      }
      parts
          .snapshots()
          .capture(
              player,
              stored -> {
                if (!stored) {
                  Texts.error(
                      player, "Your belongings could not be saved, so you were not let in.");
                  handle(new MatchEvent.Leave(id, now()));
                }
              });
    }

    private void restore(CombatantId id) {
      rewinders.remove(id);
      parts.combat().forget(id.uuid());
      awaitingSpectate.remove(id.uuid());
      poisoned.remove(id.uuid());
      switch (id) {
        case CombatantId.Bot bot -> {
          entity(bot).ifPresent(parts.boards()::hide);
          parts.bots().despawn(bot);
        }
        case CombatantId.Human human -> {
          var player = parts.context().server().getPlayer(human.uuid());
          if (player == null) {
            // Their snapshot stays held and stored, and is restored when they next join.
            return;
          }
          removeAttackSpeed(player);
          KitMenu.close(player);
          parts.boards().hide(player);
          parts.hud().hide(player);
          parts.snapshots().restore(player);
        }
      }
    }

    void enterLobby(CombatantId id) {
      withEntity(
          id,
          player -> {
            PlayerStates.wipe(player, GameMode.SURVIVAL);
            player.teleport(lobby());
            addAttackSpeed(player);
            parts.boards().show(player);
            if (!id.isBot()) {
              parts.kits().giveLobbyItems(player);
              parts.hud().show(player);
              Texts.info(
                  player,
                  "Right-click the nether star to choose a kit (or /rwf kit <id>); leave with the"
                      + " red dye or /rwf leave.");
              if (parts.recordings().enabled()) {
                Texts.info(player, Texts.RECORDING_DISCLOSURE);
              }
            }
          });
    }

    private void spectate(MatchEffect.Spectate effect) {
      withEntity(
          effect.id(),
          player -> {
            // During the death event the player may still read as alive with no health left, and
            // a bomb's Spectate arrives before the Kill that fells the same player: spectating
            // first would then kill a spectator and vanilla would respawn them at the overworld
            // spawn. Anyone the rules already count as dead spectates from their respawn.
            var fallen = match.member(effect.id()).map(member -> !member.alive()).orElse(false);
            if (fallen || player.isDead() || player.getHealth() <= 0) {
              awaitingSpectate.add(player.getUniqueId());
            } else {
              MatchRunner.this.spectate(player, effect.at());
            }
          });
    }

    private void announce(MatchEffect.Announce announce) {
      for (var member : match.members()) {
        withEntity(member.id(), player -> Texts.notice(player, announce.notice()));
      }
      parts
          .recordings()
          .event(
              now(),
              "notice",
              announce.notice().kind().name().toLowerCase(Locale.ROOT),
              Texts.render(pseudonymous(announce.notice())));
    }

    /** The notice with every player name swapped for the player's recording pseudonym. */
    private Notice pseudonymous(Notice notice) {
      var values = new HashMap<String, String>();
      for (var entry : notice.values().entrySet()) {
        values.put(entry.getKey(), pseudonymous(entry.getValue()));
      }
      return Notice.of(notice.kind(), values);
    }

    private String pseudonymous(String value) {
      for (var list : List.of(match.members(), match.departed())) {
        for (var combatant : list) {
          if (combatant.name().equals(value)) {
            return parts.recordings().pseudonym(combatant.id()).orElse("-");
          }
        }
      }
      return value;
    }

    private void sound(MatchEffect.Sound sound) {
      for (var id : sound.to()) {
        withEntity(
            id, player -> Sounds.play(parts.context().world(), Places.at(player), sound.cue()));
      }
    }

    private void bomb(String kind, String bombId, Consumer<String> action) {
      action.accept(bombId);
      parts.recordings().event(now(), kind, bombId, "");
    }

    private void kill(MatchEffect.Kill kill) {
      for (var victim : kill.victims()) {
        // The rules already count these victims dead, so died() ignores the death event that
        // setHealth raises: a rules kill (bomb) is tallied here, a world death there, never both.
        tallies.computeIfAbsent(victim, ignored -> new Tally()).deaths++;
        parts.recordings().event(now(), "killed", victim, kill.cause().name());
        withEntity(
            victim,
            player -> {
              if (!player.isDead()) {
                parts.combat().hurt(player.getUniqueId(), kill.cause());
                player.setHealth(0);
              }
            });
      }
    }

    private void poison(MatchEffect.PoisonDamage poison) {
      withEntity(
          poison.id(),
          player -> {
            if (player.isDead()) {
              return;
            }
            poisoned.add(player.getUniqueId());
            parts.combat().hurt(player.getUniqueId(), AttackType.END_OF_GAME);
            player.setHealth(Math.max(0, player.getHealth() - poison.amount()));
          });
    }

    private static void stripFood(Player player) {
      var inventory = player.getInventory();
      inventory.remove(Material.GOLDEN_APPLE);
      inventory.remove(Material.COOKED_BEEF);
    }

    private void revert() {
      var map = currentMap();
      map.revertCraters();
      parts.bombs().clear();
      map.verifyAndRepair(
          ok -> {
            if (!ok) {
              parts
                  .context()
                  .logger()
                  .error("Map {} could not be repaired; the lobby stays closed", map.map().id());
              ready = false;
              return;
            }
            handle(new MatchEvent.ResetDone());
          });
    }
  }

  /** The seconds the no-humans abort waits, for diagnostics. */
  Duration noHumansAbort() {
    return parts.config().match().noHumansAbort();
  }
}
