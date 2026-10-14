package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.snapshot.PlayerStates;
import com.shepherdjerred.thestorm.core.status.PublicGameDirectory;
import com.shepherdjerred.thestorm.rwf.adapter.content.RwfConfig;
import com.shepherdjerred.thestorm.rwf.app.LobbySizes;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.PayoutService;
import com.shepherdjerred.thestorm.rwf.app.RwfFeatures;
import com.shepherdjerred.thestorm.rwf.app.ShowcaseStart;
import com.shepherdjerred.thestorm.rwf.app.map.MapRotation;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStats;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Medic;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.Attribution;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyStatus;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSettings;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Notice;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import com.shepherdjerred.thestorm.rwf.domain.match.SoundCue;
import com.shepherdjerred.thestorm.rwf.domain.match.Vitals;
import com.shepherdjerred.thestorm.rwf.domain.record.Occurrence;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.OptionalInt;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Consumer;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * Runs the one match: feeds events to the {@link RwfMatch} and carries out its effects in order,
 * ticks it twenty times a second, offers each lobby a map vote and prepares the map it chooses,
 * fills the match with bots when the countdown starts, keeps the humans rule, settles payouts and
 * recordings when it ends, carries its humans into the next match, and publishes the read model and
 * transitions. The lobby stands in its own world and the maps in theirs; members move between them
 * only when the runner moves them. Events raised while effects are being applied wait their turn. A
 * showcase is a match an operator fills with bots alone: the humans rule is off for it and no human
 * may join it. Main thread only.
 */
final class MatchRunner implements MatchView, MatchEvents {

  /** How often holograms and the sidebar are redrawn. */
  static final int DISPLAY_EVERY_TICKS = 5;

  /**
   * What the runner works with.
   *
   * @param context the shared server services
   * @param config the module settings
   * @param snapshots human belongings
   * @param kits kit items
   * @param boards the match scoreboard
   * @param bombs bomb entities and holograms
   * @param maps every map in the rotation
   * @param bots the bot roster, when provided
   * @param combat hit bookkeeping
   * @param payouts the payout use case
   * @param store finished matches
   * @param recordings match recordings
   * @param lobby the lobby room
   * @param hud the countdown boss bar and titles
   * @param displays the lobby's rules, match board, ballot and kit alcoves
   * @param menus the kit menu, the kit shop and what each player may pick
   * @param keys item and entity tags
   * @param features the managed feature flags, read once per match
   * @param killstreaks the per-player killstreaks flag
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
      KitMenus menus,
      Keys keys,
      RwfFeatures.Source features,
      com.shepherdjerred.thestorm.rwf.app.JoinGate killstreaks,
      RwfAnalytics product) {}

  private final Parts parts;
  private final KitPowers powers;
  private final KitBridge kits;
  private final KitPicker picker;
  private final MapRotation<MapWorld> rotation;
  private final Effects effects = new Effects();
  private final ArrayDeque<MatchEvent> waiting = new ArrayDeque<>();
  private final List<Consumer<MatchNotification>> listeners = new ArrayList<>();
  private final Battlefield field;
  private final MatchLedger ledger = new MatchLedger();
  private final Map<BlockPos, Instant> hissed = new HashMap<>();

  /** Red Warfare's fuse hiss plays at most this often per bomb. */
  static final Duration HISS_EVERY = Duration.ofMillis(500);

  private final Map<CombatantId, Long> pendingPay = new HashMap<>();
  private final Set<UUID> awaitingSpectate = new HashSet<>();
  private final Set<UUID> poisoned = new HashSet<>();
  private final Set<UUID> frozen = new HashSet<>();

  /** Where each frozen member stands, to put them back should they fall. */
  private final Map<UUID, Location> starts = new HashMap<>();

  /** How far below the lobby's or the map's lowest block someone may drop before being put back. */
  static final int FALL_MARGIN = 8;

  /** Server ticks in Red Warfare's half-second timer. */
  static final int HALF_SECOND_TICKS = 10;

  private final BotArrivals arrivals;
  private final Clock clock = new Clock();
  private final Results results = new Results();
  private final Showcases showcases = new Showcases();
  private final MatchHooks hooks = new MatchHooks();
  private RwfMatch match;
  private RwfFeatures features = RwfFeatures.NONE;
  private @Nullable MapWorld current;
  private @Nullable MapWorld preparing;
  private boolean applying;
  private boolean ready;
  private boolean moving;
  private long ticks;
  private @Nullable Instant humansGoneSince;
  private @Nullable Instant liveAt;
  private @Nullable MatchSnapshot cached;
  private @Nullable RwfMatch cachedFor;
  private long cachedTick;
  private OptionalInt showcase = OptionalInt.empty();
  private @Nullable UUID keepingSnapshot;
  private int lastTitle;
  private final LobbySizes lobbySizes;
  private final com.shepherdjerred.thestorm.rwf.app.MatchExperiences experiences;
  private final List<Consumer<MatchEffect.Death>> deathWatchers = new ArrayList<>();
  private @Nullable Spectating spectating;
  private Optional<Ballot> lastBallot = Optional.empty();

  /** The loaded map bots are to be drafted for, once the step's listeners have heard it. */
  private @Nullable String draftFor;

  private @Nullable TeamChat teamChat;

  MatchRunner(Parts parts) {
    this.parts = parts;
    this.experiences =
        new com.shepherdjerred.thestorm.rwf.app.MatchExperiences(parts.config().experience());
    this.powers =
        new KitPowers(
            this,
            parts.context(),
            new KitPowers.Parts(
                parts.kits(), parts.boards(), parts.keys(), parts.combat(), parts.killstreaks()));
    this.kits = new KitBridge(this, powers);
    this.picker = new KitPicker(this, parts.menus());
    this.arrivals = new BotArrivals(parts.bots()::despawn);
    this.lobbySizes =
        new LobbySizes(
            parts.config().match().automaticSizing(),
            parts.config().match().targetCombatants(),
            parts.config().match().maxCombatants());
    this.field =
        new Battlefield(parts.combat(), new Sacrifices(this, parts.context(), parts.combat()));
    this.rotation = new MapRotation<>(parts.maps(), parts.context().random());
    this.match = RwfMatch.open(settings(), UUID.randomUUID(), parts.context().random().nextLong());
  }

  // ---- read side -------------------------------------------------------------------------------

  RwfMatch match() {
    return match;
  }

  boolean ready() {
    return ready;
  }

  LobbySizes lobbySizes() {
    return lobbySizes;
  }

  com.shepherdjerred.thestorm.rwf.app.MatchExperiences experiences() {
    return experiences;
  }

  @Override
  public Optional<com.shepherdjerred.thestorm.rwf.app.MatchExperiences.Frozen> experience(UUID id) {
    return experiences.current(id);
  }

  boolean live() {
    return match.phase() instanceof Phase.Live;
  }

  /** The match's randomness, for the few rolls the adapter makes itself. */
  java.util.random.RandomGenerator random() {
    return parts.context().random();
  }

  /** The features the current match plays with. */
  RwfFeatures features() {
    return features;
  }

  Instant now() {
    return parts.context().time().instant();
  }

  /** The map the match plays on, once one is ready. */
  Optional<MapWorld> currentMap() {
    return Optional.ofNullable(current);
  }

  MapRotation<MapWorld> rotation() {
    return rotation;
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

  /** Whether {@code entity} stands frozen at their spawn before the match goes live. */
  boolean frozen(UUID entity) {
    return frozen.contains(entity);
  }

  /** Whether the runner itself is moving a player, which the teleport guard lets through. */
  boolean moving() {
    return moving;
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

  @Override
  public Optional<Instant> noFallUntil(UUID body) {
    return powers().noFallUntil(body);
  }

  /** Whether this match is a bots-only showcase. */
  boolean showcase() {
    return showcase.isPresent();
  }

  /**
   * The entities a watcher can follow, in join order: the living fighters once teams are dealt, or
   * everyone in the lobby before that.
   */
  List<Player> followable() {
    var begun = match.phase().started();
    var out = new ArrayList<Player>();
    for (var member : match.members()) {
      if (!begun || member.alive()) {
        entity(member.id()).ifPresent(out::add);
      }
    }
    return out;
  }

  /** What kit abilities do to the world and its combatants. */
  KitPowers powers() {
    return powers;
  }

  /** How the world reaches the kit abilities. */
  KitBridge kits() {
    return kits;
  }

  /** Picking kits and the kit menu. */
  KitPicker picker() {
    return picker;
  }

  boolean awaitsSpectate(UUID player) {
    return awaitingSpectate.contains(player);
  }

  boolean poisoned(UUID player) {
    return poisoned.contains(player);
  }

  /** Runs {@code watcher} with each death, once the rules have credited it. */
  void onDeath(Consumer<MatchEffect.Death> watcher) {
    deathWatchers.add(watcher);
  }

  /** The spectator tools and team chat, wired once both sides exist. */
  void tools(Spectating spectatorTools, TeamChat chat) {
    this.spectating = spectatorTools;
    this.teamChat = chat;
  }

  @Override
  public java.util.Set<String> kitsOnOffer() {
    var offered = picker.onOffer();
    var allowed =
        experience(match.matchId())
            .map(value -> value.settings().kits())
            .orElseGet(() -> experiences.pending().kits());
    return allowed.isEmpty()
        ? offered
        : offered.stream()
            .filter(allowed::contains)
            .collect(java.util.stream.Collectors.toUnmodifiableSet());
  }

  @Override
  public Optional<MatchSnapshot> current() {
    if (!ready) {
      return Optional.empty();
    }
    return Optional.of(snapshot());
  }

  /** Accepted transitions have a snapshot even before public admission opens. */
  private MatchSnapshot snapshot() {
    var snapshot = cached;
    if (snapshot == null || cachedTick != ticks || !match.equals(cachedFor)) {
      snapshot = MatchSnapshot.of(match, now());
      cached = snapshot;
      cachedFor = match;
      cachedTick = ticks;
    }
    return snapshot;
  }

  Optional<PublicGameDirectory.Game> publicGame() {
    return current().flatMap(RunnerRules::publicGame);
  }

  List<String> recordingStatus(Player player) {
    return parts.recordings().status(player);
  }

  @Override
  public Subscription subscribe(Consumer<MatchNotification> listener) {
    listeners.add(listener);
    return () -> listeners.remove(listener);
  }

  // ---- write side ------------------------------------------------------------------------------

  /**
   * The lobby is ready: the features are read and the first vote opens. Admission opens with the
   * vote; the chosen map is prepared while the countdown runs.
   */
  void open() {
    refreshFeatures(
        () -> {
          ready = true;
          match = match.withSettings(settings());
          parts.boards().showKills(features.deathFeed());
          offerBallot();
        });
  }

  /** Reads the flags for the next match; on failure the features already in force stay. */
  private void refreshFeatures(Runnable then) {
    var _ =
        parts
            .features()
            .evaluate()
            .whenCompleteAsync(
                (read, failure) -> {
                  if (failure != null) {
                    parts
                        .context()
                        .logger()
                        .warn(
                            "Could not read the rwf feature flags; keeping {}", features, failure);
                  } else {
                    features = read;
                  }
                  parts.context().guarded("opening the rwf lobby", then);
                },
                parts.context().mainThread());
  }

  /** The domain settings for the next match: the configured rules under the current flags. */
  private MatchSettings settings() {
    var config = parts.config().match();
    var flow = features.matchFlow();
    return parts
        .config()
        .matchSettings()
        .withFlow(
            flow ? config.voteLead() : Duration.ZERO,
            flow ? config.previewLength() : Duration.ZERO,
            flow ? config.freezeLength() : Duration.ZERO,
            features.carryOver())
        .withKitPool(
            new com.shepherdjerred.thestorm.rwf.domain.kit.KitPool(experiences.pending().kits()));
  }

  /** Opens the lobby's vote: three maps with the match flow on, one drawn at random without. */
  private void offerBallot() {
    var refused = handle(ballotEvent());
    if (refused.isPresent()) {
      parts
          .context()
          .logger()
          .error("rwf: the lobby refused its vote ({}); admission stays closed", refused);
      ready = false;
    }
  }

  /** Applies {@code event}, or returns why it was refused. */
  Optional<MatchError> handle(MatchEvent event) {
    if (applying) {
      waiting.add(event);
      return Optional.empty();
    }
    var refusal =
        switch (match.on(event)) {
          case Result.Err<RwfMatch.Step, MatchError>(var error) -> Optional.of(error);
          case Result.Ok<RwfMatch.Step, MatchError>(var step) -> {
            apply(event, step);
            yield Optional.<MatchError>empty();
          }
        };
    while (!waiting.isEmpty()) {
      handle(waiting.poll());
    }
    return refusal;
  }

  /** Moves to {@code step}'s match, carries out its effects and tells the listeners. */
  private void apply(MatchEvent event, RwfMatch.Step step) {
    var before = match;
    match = step.match();
    applying = true;
    try {
      if (event instanceof MatchEvent.Stop) {
        showcases.cancel();
      }
      if (event instanceof MatchEvent.MapReady ready && match.map().isPresent()) {
        play(ready.map().id());
      }
      // A step that deals the teams may also go live, and even end (a team with nobody alive):
      // the match world (teams, bombs, the recording) must exist before its effects run.
      if (!before.phase().started() && match.phase().started()) {
        dealt();
      }
      if (!RunnerRules.reachedLive(before.phase()) && RunnerRules.reachedLive(match.phase())) {
        wentLive();
      }
      for (var effect : step.effects()) {
        applyGuarded(effect);
      }
      afterStep(before, event);
      // Who hears team and dead chat follows every death, team and phase at once, so a member
      // who just died never speaks to the living.
      var chat = teamChat;
      if (chat != null && !RunnerRules.sameRoster(before, match)) {
        chat.refresh();
      }
    } finally {
      applying = false;
    }
    notifyListeners(event, step.effects());
    // After the listeners: rwfbots confirms the map's navigation as it hears MapReady.
    showcases.afterMapReady(event);
    var draft = draftFor;
    draftFor = null;
    if (draft != null) {
      fillWithBots(draft);
    }
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
    var notification = new MatchNotification(event, applied, snapshot());
    for (var listener : List.copyOf(listeners)) {
      parts.context().guarded("notifying a match listener", () -> listener.accept(notification));
    }
  }

  /**
   * Phase changes the adapter acts on after the effects of the step that made them. Dealing the
   * teams and going live are handled before the effects, in {@link #handle}.
   */
  private void afterStep(RwfMatch before, MatchEvent event) {
    var was = before.phase();
    var is = match.phase();
    var votedBefore = before.ballot().flatMap(Ballot::chosen).isPresent();
    var voted = match.ballot().flatMap(Ballot::chosen);
    if (!votedBefore && voted.isPresent()) {
      match
          .ballot()
          .ifPresent(
              closed -> {
                ledger.ballotClosed(closed, now());
                lastBallot = Optional.of(closed);
              });
    }
    // Bots are drafted once the chosen map is loaded (rwfbots needs its navigation confirmed),
    // while the countdown runs, or as the preview opens when the map loaded only after it.
    var minHumans = parts.config().match().minHumans();
    if (RunnerRules.draftable(match, minHumans) && !RunnerRules.draftable(before, minHumans)) {
      draftFor = match.map().orElseThrow().id();
    }
    if (event instanceof MatchEvent.PickKit pick && !(was instanceof Phase.Resetting)) {
      ledger.kitSwitched(pick.id());
    }
    if (is instanceof Phase.Ended ended && !(was instanceof Phase.Ended)) {
      results.ended(ended);
    }
    if (was instanceof Phase.Live && is instanceof Phase.Resetting) {
      results.stopped(before, event);
    }
    if (is instanceof Phase.Lobby && was instanceof Phase.Resetting) {
      nextMatch();
    }
  }

  /** The chosen map is the one the match runs on now; the one played before is let go. */
  private void play(String mapId) {
    var map = rotation.byId(mapId).orElseThrow();
    current = map;
    if (preparing == map) {
      preparing = null;
    }
    rotation.play(map);
  }

  /**
   * The vote closed during the countdown: bots are drafted now for the chosen map, to fill the
   * match up to its target, and walk into the lobby one by one over the first part of what is left
   * of the countdown.
   */
  private void fillWithBots(String chosenMap) {
    experiences.freeze(match.matchId(), match.seed());
    var map = rotation.byId(chosenMap).orElseThrow();
    var draftedTarget = lobbySizes.draft(map.definition(), showcase);
    var drafted =
        parts.bots().fill(match.matchId(), Math.max(0, draftedTarget - match.members().size()));
    var now = now();
    arrivals.schedule(drafted, match.seed(), now, RunnerRules.arrivalBudget(match, now));
  }

  /** Bots whose time has come walk into the lobby, while the countdown or preview runs. */
  private void arrive(Instant now) {
    if (arrivals.size() == 0) {
      return;
    }
    if (RunnerRules.walksIn(match.phase())) {
      arrivals.arrive(now, this::joinBot);
    } else {
      arrivals.release();
    }
  }

  /** How many drafted bots are still on their way in. */
  int arriving() {
    return arrivals.size();
  }

  /** Up to {@code count} bots join the lobby now. Returns how many did. */
  private int joinBots(int count) {
    experiences.freeze(match.matchId(), match.seed());
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
    Optional<Player> spawned;
    try {
      spawned = parts.bots().spawn(bot, lobby());
    } catch (RuntimeException failure) {
      try {
        parts.bots().despawn(bot);
      } catch (RuntimeException cleanupFailure) {
        failure.addSuppressed(cleanupFailure);
      }
      throw failure;
    }
    if (spawned.isEmpty()) {
      parts.context().logger().error("Bot {} did not spawn; skipping it", bot);
      parts.bots().despawn(bot);
      return false;
    }
    if (handle(new MatchEvent.Join(bot, spawned.orElseThrow().getName(), now())).isEmpty()) {
      return true;
    }
    parts.bots().despawn(bot);
    return false;
  }

  /** The teams are dealt: the board shows them and the lobby's displays step aside. */
  private void dealt() {
    arrivals.release();
    parts.hud().hideAll();
    humanEntities().forEach(KitMenu::close);
    parts.boards().showKills(features.deathFeed());
  }

  private void wentLive() {
    // The domain stamped the start with the event's instant; a fresh clock read here would land
    // after an end decided in the same step and the match row would reject it.
    liveAt = match.phase() instanceof Phase.Live live ? live.startedAt() : now();
    humansGoneSince = null;
    pendingPay.clear();
    poisoned.clear();
    parts.hud().fight(humanEntities());
    var map = currentMap().orElseThrow();
    parts.bombs().place(map.definition());
    parts.recordings().start(match, map.definition(), now());
    var experience = experiences.freeze(match.matchId(), match.seed());
    parts
        .recordings()
        .event(
            now(),
            "settings",
            "match",
            experience.settings().canonical(experience.seed())
                + ";fingerprint="
                + experience.settings().fingerprint(experience.seed()));
    lastBallot.ifPresent(
        ballot ->
            parts
                .recordings()
                .ballot(
                    ballot.candidates().stream()
                        .map(
                            c ->
                                new Occurrence.Ballot.Candidate(c.mapId(), ballot.count(c.mapId())))
                        .toList(),
                    ballot.chosen().orElseThrow()));
    lastBallot = Optional.empty();
    for (var member : match.members()) {
      entity(member.id())
          .ifPresent(
              player ->
                  parts
                      .boards()
                      .assign(
                          player,
                          member.team().orElseThrow(),
                          member.id().isBot(),
                          member.kit().filter(Medic.ID::equals).isPresent()));
      parts.recordings().event(now(), "joined", member.id(), member.team().orElseThrow().name());
    }
  }

  /**
   * The map is reverted: the next match opens in the lobby with whoever was carried over, under the
   * flags read as the map reset, and its vote opens.
   */
  private void nextMatch() {
    lobbySizes.resetDraft();
    ledger.reset();
    field.clear();
    hissed.clear();
    pendingPay.clear();
    poisoned.clear();
    awaitingSpectate.clear();
    frozen.clear();
    starts.clear();
    showcase = OptionalInt.empty();
    showcases.cancel();
    parts.combat().clear();
    parts.boards().reset();
    parts.bombs().clear();
    match =
        match.successor(settings(), UUID.randomUUID(), parts.context().random().nextLong(), now());
    parts.boards().showKills(features.deathFeed());
    for (var member : match.members()) {
      entity(member.id()).ifPresent(parts.boards()::show);
    }
    offerBallot();
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
    var refusal = showcases.refusal(count);
    return refusal.isPresent() ? refusal : showcases.fill(count);
  }

  Optional<String> startSeededShowcase(UUID lobbyId, int count, long seed) {
    if (!match.matchId().equals(lobbyId)) {
      return Optional.of("The requested showcase lobby is no longer current.");
    }
    var refusal = showcases.refusal(count);
    if (refusal.isPresent()) {
      return refusal;
    }
    if (!match.members().isEmpty()) {
      return Optional.of("A seeded showcase requires an empty lobby.");
    }
    var previous = match;
    var world = parts.context().mapWorld();
    var previousTime = world.getTime();
    match = match.reseedEmptyLobby(seed);
    experiences.reseedEmptyLobby(match.matchId(), seed);
    world.setTime(match.startingWorldTime());
    refusal = showcases.fill(count);
    if (refusal.isPresent()) {
      match = previous;
      experiences.reseedEmptyLobby(previous.matchId(), previous.seed());
      world.setTime(previousTime);
    }
    return refusal;
  }

  Optional<String> stopShowcase(UUID matchId) {
    if (!match.matchId().equals(matchId) || showcase.isEmpty() || humans() > 0) {
      return Optional.of("No bots-only showcase with that id is running.");
    }
    if (!(match.phase() instanceof Phase.Ended) && !(match.phase() instanceof Phase.Resetting)) {
      showcases.cancel();
      var refusal = handle(new MatchEvent.Stop());
      return refusal.map(Object::toString);
    }
    return Optional.empty();
  }

  /** The match is stopping for good (disable): restore everyone, despawn bots. */
  void stop() {
    showcases.cancel();
    rotation.close();
    if (!(match.phase() instanceof Phase.Resetting)) {
      handle(new MatchEvent.Stop());
    } else {
      // Members carried over wait in the lobby while the map resets: they are let go too.
      for (var member : match.members()) {
        handle(new MatchEvent.Leave(member.id(), now()));
      }
    }
    arrivals.release();
    parts.hud().hideAll();
    ready = false;
  }

  /** Requested showcases wait for the chosen map's consumers before bodies are drafted. */
  private final class Showcases {
    private boolean pending;

    Optional<String> refusal(int count) {
      return new ShowcaseStart(
              parts.config().match().maxCombatants(),
              ready,
              parts.bots().roster().isPresent(),
              showcase.isPresent(),
              humans(),
              match.phase() instanceof Phase.Lobby)
          .refusal(count);
    }

    Optional<String> fill(int count) {
      showcase = OptionalInt.of(count);
      if (match.map().isPresent()) {
        return draft();
      }
      pending = true;
      var refused = handle(new MatchEvent.CloseVote());
      if (refused.isPresent()) {
        pending = false;
        showcase = OptionalInt.empty();
        return refused.map(Object::toString);
      }
      return Optional.empty();
    }

    void afterMapReady(MatchEvent event) {
      if (event instanceof MatchEvent.MapReady && pending) {
        draft().ifPresent(parts.context().logger()::error);
      }
    }

    void cancel() {
      pending = false;
      arrivals.release();
    }

    /** The chosen map's listeners have confirmed navigation; the requested bodies may join. */
    private Optional<String> draft() {
      pending = false;
      var count = showcase.orElseThrow();
      joinBots(count - match.members().size());
      if (match.members().isEmpty()) {
        showcase = OptionalInt.empty();
        return Optional.of("No bot could be spawned for the showcase; see the log.");
      }
      parts.context().logger().info("rwf match {} is a showcase of {}", match.matchId(), count);
      return Optional.empty();
    }
  }

  /** What a finished or stopped match leaves behind: its record, payouts and recording. */
  private final class Results {

    /** The match ended with a result: settle payouts, close the recording, write the match. */
    void ended(Phase.Ended ended) {
      Celebration.takeOff(
          match.members().stream()
              .filter(Combatant::alive)
              .flatMap(member -> entity(member.id()).stream())
              .toList());
      var rows = new ArrayList<MatchStore.PlayerRow>();
      var all = new ArrayList<>(match.members());
      all.addAll(match.departed());
      for (var member : all) {
        if (member.id().isBot()) {
          continue;
        }
        var credits = pendingPay.getOrDefault(member.id(), 0L);
        var won = ended.outcome().winner().filter(team -> member.onTeam(team)).isPresent();
        rows.add(RunnerRules.playerRow(match.matchId(), member, won, credits));
      }
      var row =
          new MatchStore.MatchRow(
              match.matchId(),
              currentMap().orElseThrow().id(),
              RunnerRules.startedAtFor(liveAt, ended.at()),
              ended.at(),
              ended.outcome().winner(),
              (int) all.stream().filter(m -> !m.id().isBot()).count(),
              (int) all.stream().filter(m -> m.id().isBot()).count());
      var reason =
          switch (ended.outcome()) {
            case Outcome.Winner _ -> RecordEnd.Reason.LAST_TEAM_STANDING;
            case Outcome.Draw _ -> RecordEnd.Reason.DRAW;
            case Outcome.Stopped _ -> RecordEnd.Reason.STOPPED;
          };
      settle(row, rows, stats(all, Optional.of(ended.outcome()), row, reason));
      closeRecording(ended.outcome().winner(), reason);
    }

    /** A live match was stopped (admin, no humans, disable): no payout, a stopped record. */
    void stopped(RwfMatch before, MatchEvent event) {
      var live = liveAt;
      if (live == null) {
        return;
      }
      var all = new ArrayList<>(before.members());
      all.addAll(before.departed());
      var rows = new ArrayList<MatchStore.PlayerRow>();
      for (var member : all) {
        if (!member.id().isBot()) {
          rows.add(
              RunnerRules.playerRow(match.matchId(), member, false, 0)
                  .withOutcome(MatchStore.Outcome.STOPPED));
        }
      }
      var row =
          new MatchStore.MatchRow(
              match.matchId(),
              before.map().orElseThrow().id(),
              live,
              now(),
              Optional.empty(),
              rows.size(),
              (int) all.stream().filter(m -> m.id().isBot()).count());
      settle(row, rows, stats(all, Optional.empty(), row, RecordEnd.Reason.STOPPED));
      closeRecording(Optional.empty(), RecordEnd.Reason.STOPPED);
      parts.context().logger().info("rwf match {} stopped by {}", match.matchId(), event);
    }

    /** How the match was played, for the statistics written with its row. */
    private MatchStats stats(
        List<Combatant> all,
        Optional<Outcome> outcome,
        MatchStore.MatchRow row,
        RecordEnd.Reason reason) {
      return new MatchStats(
          new MatchStats.Details(
              match.seed(),
              Duration.between(row.startedAt(), row.endedAt()),
              reason.name(),
              ledger.ballot(),
              currentMap().map(map -> map.definition().blocksSha256()).orElse("")),
          ledger.players(all, outcome, row.startedAt(), row.endedAt()),
          ledger.events());
    }

    private void settle(
        MatchStore.MatchRow row, List<MatchStore.PlayerRow> rows, MatchStats stats) {
      parts
          .context()
          .onMain(
              parts.payouts().settle(row, rows, Optional.of(stats)),
              paid -> Texts.charged(parts.context().server(), paid),
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
  }

  // ---- the clock -------------------------------------------------------------------------------

  /** One server tick. */
  void tick() {
    clock.tick();
  }

  /** {@code id} is no longer a ghost. */
  private void releaseTools(CombatantId id) {
    var tools = spectating;
    if (tools != null) {
      tools.release(id);
    }
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
   * What the runner does each server tick: keeping the humans rule, walking bots in, ticking the
   * match, and the lobby, preview and live chores.
   */
  private final class Clock {

    /** One server tick. */
    private void tick() {
      ticks++;
      // Even while the lobby is closed for a repair, nobody falls forever.
      keepOutOfTheVoid();
      if (!ready) {
        return;
      }
      var tools = spectating;
      if (ticks % 20 == 0 && tools != null) {
        tools.tick();
      }
      var now = now();
      keepHumansRule(now);
      arrive(now);
      countOnline();
      var motions = new HashMap<CombatantId, Motion>();
      handle(
          new MatchEvent.Tick(
              now, vitals(motions), motions, Battlefield.ground(parts.context().mapWorld())));
      if (live()) {
        liveTick(now);
      } else if (match.phase() instanceof Phase.Ended ended) {
        celebrate(ended);
      } else if (RunnerRules.inLobby(match.phase())) {
        lobbyTick(now);
      } else if (match.phase() instanceof Phase.Preview) {
        previewTick();
      }
      if (ticks % DISPLAY_EVERY_TICKS == 0) {
        current()
            .ifPresent(
                snapshot ->
                    parts
                        .boards()
                        .render(
                            snapshot,
                            parts.bombs().concealed(BombMarkers.Sabotage.of(MatchRunner.this))));
        var chat = teamChat;
        if (chat != null) {
          chat.refresh();
        }
        var status = LobbyStatus.of(match, now);
        parts.hud().update(status);
        parts.displays().update(status, match.ballot());
      }
    }

    /**
     * Until the match goes live, the rules learn how many players are on the server whenever the
     * count changes, for the Medic's small-game rule. Citizens' bots are not online players.
     */
    private void countOnline() {
      if (live() || match.phase() instanceof Phase.Ended) {
        return;
      }
      var online = parts.context().server().getOnlinePlayers().size();
      if (online != match.abilities().online()) {
        handle(new MatchEvent.Online(online));
      }
    }

    /**
     * In the lobby: members who leave the room (falling below its floor, say) are put back at its
     * spawn, and the last five seconds of the countdown are shown as titles.
     */
    private void lobbyTick(Instant now) {
      for (var member : match.members()) {
        entity(member.id())
            .filter(player -> !player.isDead() && !parts.lobby().contains(Places.at(player)))
            .ifPresent(player -> move(player, lobby()));
      }
      var status = LobbyStatus.of(match, now);
      var seconds = status.stage() == LobbyStatus.Stage.COUNTDOWN ? status.secondsLeft() : 0;
      if (seconds != lastTitle && seconds > 0) {
        parts.hud().countdown(humanEntities(), seconds);
      }
      lastTitle = seconds;
    }

    /** Every half second of the end screen: fireworks over the winners, in their colour. */
    private void celebrate(Phase.Ended ended) {
      if (ticks % HALF_SECOND_TICKS != 0) {
        return;
      }
      ended
          .outcome()
          .winner()
          .ifPresent(
              team ->
                  Celebration.halfSecond(
                      match.members().stream()
                          .filter(member -> member.team().filter(team::equals).isPresent())
                          .flatMap(member -> entity(member.id()).stream())
                          .toList(),
                      Hats.dye(team),
                      parts.context().random()));
    }

    /**
     * Nothing hurts before the match goes live, the void included, so anyone who drops more than
     * {@link #FALL_MARGIN} blocks below the lobby or the map is put back instead: in the lobby at
     * its spawn, a frozen member at their start, and everyone else not fighting (previewing, dead,
     * watching, or after the end) at the map's spectator point. Live fighters are left to the void
     * death the rules deal them.
     */
    private void keepOutOfTheVoid() {
      var lobbyFloor = parts.lobby().layout().region().min().y() - FALL_MARGIN;
      for (var player : parts.context().lobbyWorld().getPlayers()) {
        if (Places.at(player).getY() < lobbyFloor && ours(player)) {
          move(player, lobby());
        }
      }
      var map = currentMap();
      if (map.isEmpty()) {
        return;
      }
      var mapFloor = map.orElseThrow().definition().border().min().y() - FALL_MARGIN;
      for (var player : parts.context().mapWorld().getPlayers()) {
        if (Places.at(player).getY() < mapFloor
            && ours(player)
            && !fighting(player.getUniqueId())) {
          var start = starts.get(player.getUniqueId());
          move(player, start != null && frozen(player.getUniqueId()) ? start : watchPoint());
        }
      }
    }

    /**
     * Whether {@code player} is the match's to put back: a member, or a watcher (watchers are the
     * only non-members in spectator mode in these worlds; staff building in creative are left be).
     */
    private boolean ours(Player player) {
      return memberOf(player.getUniqueId()).isPresent()
          || player.getGameMode() == GameMode.SPECTATOR;
    }

    /**
     * While previewing, a member who flies out of the map is brought back to its spectator point.
     */
    private void previewTick() {
      var map = currentMap().orElseThrow();
      for (var member : match.members()) {
        entity(member.id())
            .filter(player -> !member.id().isBot() && !map.contains(Places.at(player)))
            .ifPresent(player -> move(player, spectatorPoint()));
      }
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
      var waiting =
          match.phase() instanceof Phase.Lobby || match.phase() instanceof Phase.Countdown;
      if (waiting && humans() < minHumans) {
        arrivals.release();
        for (var member : match.members()) {
          if (member.id().isBot()) {
            handle(new MatchEvent.Leave(member.id(), now));
          }
        }
        return;
      }
      var playing =
          match.phase() instanceof Phase.Live
              || match.phase() instanceof Phase.Preview
              || match.phase() instanceof Phase.Freeze
              || match.phase() instanceof Phase.Preparing;
      if (!playing || humans() > 0) {
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

    /** The vitals of every living combatant, and how each moved into {@code motions}. */
    private Map<CombatantId, Vitals> vitals(Map<CombatantId, Motion> motions) {
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
        vitals.put(
            member.id(),
            new Vitals(
                Places.vec(Places.at(player)),
                PlayerAttributes.maxHealth(player),
                Math.max(0, player.getHealth())));
        if (live()) {
          motions.put(member.id(), powers.motion(player));
        }
      }
      return vitals;
    }

    private void liveTick(Instant now) {
      var border = currentMap().orElseThrow().definition().border();
      for (var member : match.members()) {
        if (!member.alive()) {
          continue;
        }
        var entity = entity(member.id());
        if (entity.isEmpty()) {
          continue;
        }
        var player = entity.orElseThrow();
        parts.recordings().sample(now, ticks, member, player);
        ledger.walked(member.id(), Places.vec(Places.at(player)));
        if (field.fellIntoVoid(member.id(), player, border)) {
          continue;
        }
        if (ticks % Battlefield.BORDER_EVERY_TICKS == 0) {
          field.hurtOutside(member.id(), player, border, now);
        }
      }
      if (parts.recordings().pulseDue()) {
        pulse();
      }
      if (ticks % DISPLAY_EVERY_TICKS == 0) {
        current()
            .ifPresent(
                snapshot ->
                    parts.bombs().update(snapshot, BombMarkers.Sabotage.of(MatchRunner.this)));
      }
      powers.tick(now);
    }

    /** The recording's five-second picture: who is alive per team, each bomb, the poison. */
    private void pulse() {
      var snapshot = current().orElseThrow();
      var alive = new EnumMap<TeamColor, Integer>(TeamColor.class);
      for (var team : snapshot.teams()) {
        alive.put(
            team,
            (int)
                snapshot.combatants().stream()
                    .filter(c -> c.alive() && c.team().filter(team::equals).isPresent())
                    .count());
      }
      var bombs = new TreeMap<String, Occurrence.Pulse.BombStatus>();
      for (var bomb : snapshot.bombs()) {
        bombs.put(
            bomb.id(),
            switch (bomb.state()) {
              case MatchSnapshot.BombView.State.Idle _ -> Occurrence.Pulse.BombStatus.IDLE;
              case MatchSnapshot.BombView.State.Arming _ -> Occurrence.Pulse.BombStatus.ARMING;
              case MatchSnapshot.BombView.State.Armed armed ->
                  armed.defusing().isPresent()
                      ? Occurrence.Pulse.BombStatus.DEFUSING
                      : Occurrence.Pulse.BombStatus.ARMED;
              case MatchSnapshot.BombView.State.Destroyed _ ->
                  Occurrence.Pulse.BombStatus.DESTROYED;
            });
      }
      snapshot.poison().ifPresent(poison -> parts.recordings().pulse(alive, bombs, poison.stage()));
    }
  }

  // ---- things players do -----------------------------------------------------------------------

  /** A player asks to join: admission checks, then the match decides. */
  Optional<String> admit(Player player) {
    var refusal =
        admission(player)
            .or(
                () ->
                    snapshotRefusal(
                        player,
                        () -> admit(player).ifPresent(error -> Texts.error(player, error))));
    if (refusal.isPresent()) {
      return refusal;
    }
    var refused =
        handle(new MatchEvent.Join(human(player), player.getName(), now())).map(Texts::describe);
    if (refused.isEmpty()) {
      picker.load(player.getUniqueId());
    }
    return refused;
  }

  /** Whether a player asking to join now would be turned away because a match is under way. */
  boolean underWay() {
    return ready && !match.phase().admits();
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
      var refused =
          handle(new MatchEvent.Join(human(player), player.getName(), now())).map(Texts::describe);
      if (refused.isEmpty()) {
        picker.load(player.getUniqueId());
      }
      return refused;
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

  /**
   * Why {@code player} may not have a snapshot taken now, as they should read it. While their last
   * restore is still being confirmed in saved player data, {@code retry} runs again once it is.
   */
  Optional<String> snapshotRefusal(Player player, Runnable retry) {
    return parts
        .snapshots()
        .refusal(player.getUniqueId())
        .map(
            refusal ->
                switch (refusal) {
                  case NOT_LOADED -> "The match is still starting up; try again in a moment.";
                  case CLEANUP_PENDING -> {
                    parts
                        .snapshots()
                        .whenClean(
                            player.getUniqueId(),
                            () -> {
                              if (player.isOnline()) {
                                retry.run();
                              }
                            });
                    yield "Your belongings from your last match are still being saved; trying"
                        + " again in a moment.";
                  }
                  case CLEANUP_STALLED ->
                      "Your restored belongings could not be confirmed as saved. Reconnect to"
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
   * A member was hurt in a live match, before the damage lands; the match's damage log keeps it for
   * kills and assists.
   */
  void damaged(Player victim, Optional<UUID> attacker, double damage, AttackType cause) {
    var before = victim.getHealth();
    var member = memberOf(victim.getUniqueId());
    if (member.isEmpty() || !live() || !member.orElseThrow().alive()) {
      return;
    }
    var by = attacker.flatMap(this::memberOf).map(Combatant::id);
    ledger.damaged(by, member.orElseThrow().id(), Math.min(before, damage));
    if (by.isPresent() && cause.has(AttackType.Flag.PROJECTILE)) {
      ledger.hit(by.orElseThrow());
    }
    handle(
        new MatchEvent.Damaged(
            member.orElseThrow().id(),
            by,
            damage,
            before,
            PlayerAttributes.maxHealth(victim),
            cause,
            now()));
  }

  /** A fighter loosed {@code projectile}. */
  void shot(Player shooter, Entity projectile) {
    if (!fighting(shooter.getUniqueId())) {
      return;
    }
    memberOf(shooter.getUniqueId())
        .ifPresent(
            member -> {
              ledger.shot(member.id());
              parts
                  .recordings()
                  .projectile(
                      member.id(),
                      machineName(projectile.getType().name()),
                      Places.vec(Places.at(projectile)),
                      Places.vec(projectile.getVelocity()));
            });
  }

  /** A fighter ate a steak. */
  void ateSteak(Player eater) {
    memberOf(eater.getUniqueId()).ifPresent(member -> ledger.steak(member.id()));
  }

  /** What kit abilities, killstreaks, effects and placed blocks report to the match. */
  MatchHooks hooks() {
    return hooks;
  }

  /**
   * The match's hooks for what kits and killstreaks do: each use counts towards the player's stats
   * where it should and becomes a recording row. Main thread.
   */
  final class MatchHooks {

    /**
     * {@code id} used {@code ability} (aimed at {@code target}, if anything): counted, recorded.
     */
    void abilityUsed(CombatantId id, String ability, Optional<CombatantId> target) {
      ledger.ability(id);
      target.ifPresentOrElse(
          on -> parts.recordings().ability(id, ability, on),
          () -> parts.recordings().ability(id, ability, Optional.empty()));
    }

    /** {@code id} used the {@code streak} reward they earned at {@code kills}. */
    void killstreakUsed(CombatantId id, String streak, int kills) {
      parts.recordings().killstreak(id, streak, kills);
      parts.product().killstreakUsed(id, streak, kills);
    }

    /** {@code id} was given {@code effect} at {@code amplifier} for {@code ticks}. */
    void effectApplied(CombatantId id, String effect, int amplifier, int ticks) {
      parts.recordings().effect(id, effect, amplifier, ticks);
    }

    /** A kit placed {@code state} at {@code at}: a barricade or a banner. */
    void blockPlaced(BlockPos at, String state, Occurrence.BlockChange.Reason reason) {
      parts.recordings().blockChange(at, state, reason);
    }
  }

  /** A name as recordings keep it: lower case, words joined by underscores. */
  static String machineName(String name) {
    return name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_.:-]+", "_");
  }

  /** {@code /suicide}: the fighter dies by their own hand, as Red Warfare's command had it. */
  void suicide(Player player) {
    parts.combat().hurt(player, AttackType.SUICIDE, player.getHealth());
    player.setHealth(0);
  }

  /**
   * An operator's hard stop: the match is stopped if it can be, and anyone still a member (carried
   * over while the map resets) is let go too.
   */
  void forceStop() {
    if (!(match.phase() instanceof Phase.Resetting)) {
      handle(new MatchEvent.Stop());
    }
    for (var member : match.members()) {
      handle(new MatchEvent.Leave(member.id(), now()));
    }
    arrivals.release();
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
    var killerMember = killer.flatMap(this::memberOf);
    var killerId = killerMember.map(Combatant::id);
    var killerEntity = killerId.flatMap(this::entity).filter(entity -> !entity.isDead());
    var weapon =
        killerEntity
            .map(entity -> entity.getInventory().getItemInMainHand().getType())
            .filter(type -> type != Material.AIR)
            .map(type -> type.name());
    var distance =
        killerEntity
            .filter(entity -> entity.getWorld().equals(player.getWorld()))
            .map(entity -> OptionalDouble.of(Places.at(entity).distance(Places.at(player))))
            .orElseGet(OptionalDouble::empty);
    var killerHealth =
        killerEntity
            .map(entity -> OptionalDouble.of(entity.getHealth()))
            .orElseGet(OptionalDouble::empty);
    parts
        .recordings()
        .event(
            now(),
            "died",
            victim.orElseThrow().id(),
            killerId.flatMap(parts.recordings()::pseudonym).orElse("-") + " " + cause.name());
    handle(
        new MatchEvent.Died(
            victim.orElseThrow().id(),
            new Attribution(killerId, Map.of(), cause, weapon, distance),
            killerHealth,
            now()));
  }

  /** A dead member respawned: they watch from the spectator point. */
  void respawned(Player player) {
    if (awaitingSpectate.remove(player.getUniqueId())) {
      spectate(player, currentMap().orElseThrow().definition().spectatorPoint());
    }
  }

  /** Whether {@code player} is a member who cannot be hurt: waiting, previewing or frozen. */
  boolean waiting(UUID player) {
    return memberOf(player).isPresent()
        && !(match.phase() instanceof Phase.Live)
        && !(match.phase() instanceof Phase.Ended);
  }

  /**
   * A member died before the start and respawned in the lobby: they are made ready again, with the
   * kit they picked.
   */
  void respawnedInLobby(Player player) {
    var member = memberOf(player.getUniqueId());
    if (member.isEmpty() || !RunnerRules.inLobby(match.phase())) {
      return;
    }
    effects.enterLobby(member.orElseThrow().id());
    member.orElseThrow().kit().ifPresent(kit -> effects.equip(member.orElseThrow().id(), kit));
  }

  /** {@code player} right-clicked podium {@code index}: a vote for the map on it. */
  Optional<String> voteAt(Player player, int index) {
    if (!features.matchFlow()) {
      return Optional.of("Map voting is not open yet.");
    }
    var candidates = match.ballot().map(Ballot::candidates).orElseGet(List::of);
    if (index >= candidates.size()) {
      return Optional.of(Texts.describe(MatchError.NO_BALLOT));
    }
    return vote(player, candidates.get(index).mapId());
  }

  /** {@code player} votes for {@code mapId}; why not, if not. */
  Optional<String> vote(Player player, String mapId) {
    var member = memberOf(player.getUniqueId());
    if (member.isEmpty()) {
      return Optional.of(Texts.describe(MatchError.NOT_A_MEMBER));
    }
    return handle(new MatchEvent.Vote(member.orElseThrow().id(), mapId)).map(Texts::describe);
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

  /** Moves past the teleport guard; a bot crossing worlds returns its replacement body. */
  Player move(Player player, Location to) {
    var was = moving;
    moving = true;
    try {
      if (parts.bots().isBot(player.getUniqueId())) {
        var id = memberOf(player.getUniqueId()).orElseThrow().id();
        if (!(id instanceof CombatantId.Bot bot)) {
          throw new IllegalStateException("bot body has a human combatant id: " + id);
        }
        return parts.bots().move(bot, to);
      }
      player.teleport(to);
      return player;
    } finally {
      moving = was;
    }
  }

  private void spectate(Player player, Spawn at) {
    powers.clear(player);
    var where = Places.location(parts.context().mapWorld(), at);
    var tools = spectating;
    if (tools != null
        && memberOf(player.getUniqueId()).isPresent()
        && tools.spectate(player, where)) {
      return;
    }
    PlayerStates.wipe(player, GameMode.SPECTATOR);
    move(player, where);
  }

  Location lobby() {
    return parts.lobby().spawn();
  }

  LobbyRoom lobbyRoom() {
    return parts.lobby();
  }

  /** The current map's spectator point, or the configured one before any map is ready. */
  Location spectatorPoint() {
    var map = current;
    var spawn =
        map == null ? parts.config().spectator().toSpawn() : map.definition().spectatorPoint();
    return Places.location(parts.context().mapWorld(), spawn);
  }

  /** Where a watcher stands: the map's spectator point, or the lobby before any map is ready. */
  Location watchPoint() {
    var map = current;
    return map == null
        ? lobby()
        : Places.location(parts.context().mapWorld(), map.definition().spectatorPoint());
  }

  // ---- effects ---------------------------------------------------------------------------------

  /** Carries out one {@link MatchEffect}. */
  private final class Effects {

    void apply(MatchEffect effect) {
      if (!applyToCombatant(effect) && !applyToFlow(effect)) {
        applyToWorld(effect);
      }
    }

    /** Effects aimed at one or more combatants; false if {@code effect} is not one of them. */
    private boolean applyToCombatant(MatchEffect effect) {
      switch (effect) {
        case MatchEffect.CaptureSnapshot capture -> capture(capture.id());
        case MatchEffect.Restore restore -> restore(restore.id());
        case MatchEffect.EnterLobby enter -> enterLobby(enter.id());
        case MatchEffect.ReturnToLobby back -> returnToLobby(back.id(), back.kitId());
        case MatchEffect.Spectate spectate -> spectate(spectate);
        case MatchEffect.Teleport teleport ->
            withEntity(
                teleport.id(),
                player -> move(player, Places.location(parts.context().mapWorld(), teleport.to())));
        case MatchEffect.Equip equip -> equip(equip.id(), equip.kitId());
        case MatchEffect.GiveFuse fuse ->
            withEntity(fuse.id(), player -> parts.kits().giveFuse(player, fuse.bonus()));
        case MatchEffect.Tell tell ->
            tell.to().forEach(id -> withEntity(id, player -> notice(player, tell.notice())));
        case MatchEffect.Sound sound -> sound(sound);
        case MatchEffect.Kill kill -> kill(kill);
        case MatchEffect.PoisonDamage poison -> poison(poison);
        case MatchEffect.StripFood strip ->
            strip.from().forEach(id -> withEntity(id, Effects::stripFood));
        case MatchEffect.Pay pay -> pendingPay.merge(pay.id(), pay.credits(), Long::sum);
        case MatchEffect.RecordStat stat -> {
          ledger.stat(stat.id(), stat.stat(), now());
          parts.recordings().event(now(), "stat", stat.id(), stat.stat());
        }
        case MatchEffect.Ability ability -> powers.apply(ability.effect());
        case MatchEffect.KillstreakEarned earned -> powers.streaks().grant(earned);
        case MatchEffect.PreviewMap preview ->
            preview.ids().forEach(id -> withEntity(id, player -> preview(id, player, preview)));
        case MatchEffect.Freeze freeze -> freeze.ids().forEach(this::freeze);
        case MatchEffect.Unfreeze unfreeze ->
            unfreeze.ids().forEach(id -> frozen.remove(id.uuid()));
        case MatchEffect.Death death -> death(death);
        default -> {
          return false;
        }
      }
      return true;
    }

    /** Effects that steer the flow: the vote and the map's preparation. */
    private boolean applyToFlow(MatchEffect effect) {
      switch (effect) {
        case MatchEffect.NeedBallot _ -> waiting.add(ballotEvent());
        case MatchEffect.PrepareMap prepare -> prepareMap(prepare.mapId());
        default -> {
          return false;
        }
      }
      return true;
    }

    /** Effects on the world and the whole match. */
    private void applyToWorld(MatchEffect effect) {
      var world = parts.context().mapWorld();
      switch (effect) {
        case MatchEffect.Announce announce -> announce(announce);
        case MatchEffect.SoundAt sound -> soundAt(sound);
        case MatchEffect.SetTime time -> world.setTime(time.ticks());
        case MatchEffect.BombArmed armed -> {
          ledger.bombArmed(armed.bombId(), now());
          bomb("armed", armed.bombId(), parts.bombs()::arm);
        }
        case MatchEffect.BombRestored restored ->
            bomb("defused", restored.bombId(), parts.bombs()::restore);
        case MatchEffect.BombRemoved removed ->
            bomb("removed", removed.bombId(), parts.bombs()::remove);
        case MatchEffect.Explode explode -> {
          ledger.exploded(explode.bombId(), now());
          bomb("exploded", explode.bombId(), parts.bombs()::explode);
        }
        case MatchEffect.Crater crater ->
            currentMap()
                .orElseThrow()
                .crater(
                    crater.center(),
                    crater.radius(),
                    (at, state) ->
                        parts
                            .recordings()
                            .blockChange(at, state, Occurrence.BlockChange.Reason.CRATER));
        case MatchEffect.RevertCraters _ -> {
          powers.reset();
          revert();
        }
        default -> throw new IllegalStateException("unhandled effect " + effect);
      }
    }

    /** A notice, unless it belongs to the death feed and that is off. */
    private void notice(Player player, Notice notice) {
      if (!features.deathFeed() && Texts.DEATH_FEED.contains(notice.kind())) {
        return;
      }
      Texts.notice(player, notice);
    }

    /**
     * Gives {@code id} the kit; a human who may still change kit also gets the lobby's selector and
     * leave item back, which equipping takes away.
     */
    void equip(CombatantId id, String kitId) {
      withEntity(
          id,
          player -> {
            parts
                .kits()
                .equip(
                    player,
                    parts.kits().require(kitId),
                    match.member(id).flatMap(Combatant::team),
                    parts.menus().armory().layout(id.uuid(), kitId));
            member(id)
                .flatMap(Combatant::team)
                .ifPresent(
                    team ->
                        player
                            .getInventory()
                            .setItem(KitFactory.TEAM_SLOT, parts.kits().teamHotbar(team)));
            if (!id.isBot()
                && (match.phase().kitsOpen() || match.phase() instanceof Phase.Resetting)) {
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
      releaseTools(id);
      parts.combat().forget(id.uuid());
      awaitingSpectate.remove(id.uuid());
      poisoned.remove(id.uuid());
      frozen.remove(id.uuid());
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
          PlayerAttributes.removeAttackSpeed(player);
          powers.clear(player);
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
            powers.clear(player);
            PlayerStates.wipe(player, GameMode.SURVIVAL);
            var moved = move(player, lobby());
            PlayerAttributes.addAttackSpeed(moved);
            parts.boards().show(moved);
            if (!id.isBot()) {
              parts.kits().giveLobbyItems(player);
              var chat = teamChat;
              if (chat != null) {
                chat.entered(player.getUniqueId());
              }
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

    /**
     * A member carried into the next match: out of spectator mode, back in the lobby with their
     * kit, the selector and the leave item. Their belongings stay held.
     */
    private void returnToLobby(CombatantId id, String kitId) {
      releaseTools(id);
      parts.combat().forget(id.uuid());
      awaitingSpectate.remove(id.uuid());
      poisoned.remove(id.uuid());
      frozen.remove(id.uuid());
      withEntity(
          id,
          player -> {
            if (player.getGameMode() == GameMode.SPECTATOR) {
              player.setSpectatorTarget(null);
            }
            parts.boards().unassign(player);
            enterLobby(id);
            equip(id, kitId);
          });
    }

    /** A member flies over the map in adventure mode, unhurt, keeping their kit selector. */
    private void preview(CombatantId id, Player player, MatchEffect.PreviewMap preview) {
      if (id.isBot()) {
        // Bots wait in the lobby until the teams are dealt.
        return;
      }
      player.setGameMode(GameMode.ADVENTURE);
      player.setAllowFlight(true);
      move(player, Places.location(parts.context().mapWorld(), preview.at()));
      player.setFlying(true);
    }

    /** A member stands still at their spawn, back on their feet. */
    private void freeze(CombatantId id) {
      frozen.add(id.uuid());
      entity(id).ifPresent(player -> starts.put(id.uuid(), Places.at(player)));
      withEntity(
          id,
          player -> {
            if (!id.isBot()) {
              player.setFlying(false);
              player.setAllowFlight(false);
              player.setGameMode(GameMode.SURVIVAL);
            }
          });
    }

    /** A death: the tab list shows the killer's kills, and assists count towards streaks. */
    private void death(MatchEffect.Death death) {
      var killer = death.attribution().killer();
      ledger.death(
          death,
          killer.flatMap(MatchRunner.this::member).flatMap(Combatant::kit),
          entity(death.victim()).map(player -> Places.vec(Places.at(player))),
          now());
      killer
          .flatMap(MatchRunner.this::member)
          .ifPresent(
              by -> {
                if (features.deathFeed()) {
                  parts.boards().kills(by.name(), by.score().kills());
                }
              });
      parts
          .recordings()
          .kill(
              new Recordings.Death(
                  death.victim(),
                  killer,
                  machineName(death.attribution().cause().name()),
                  death.attribution().weapon().map(MatchRunner::machineName),
                  death.attribution().distance(),
                  death.attribution().assists()));
      for (var watcher : List.copyOf(deathWatchers)) {
        parts.context().guarded("telling a death watcher", () -> watcher.accept(death));
      }
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
        withEntity(member.id(), player -> notice(player, announce.notice()));
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
        withEntity(id, player -> Sounds.playTo(player, sound.cue(), features.bombEffects()));
      }
    }

    /**
     * A sound at a bomb. With the bomb effects on, each click on a bomb puffs large smoke above it
     * and its hiss plays at most every {@link #HISS_EVERY}, as Red Warfare had it.
     */
    private void soundAt(MatchEffect.SoundAt sound) {
      var world = parts.context().mapWorld();
      var at = Places.center(world, sound.at());
      var original = features.bombEffects();
      if (original && sound.cue() == SoundCue.FUSE_HISS) {
        world.spawnParticle(Particle.LARGE_SMOKE, at.clone().add(0, 1, 0), 1);
        var last = hissed.get(sound.at());
        var now = now();
        if (last != null && now.isBefore(last.plus(HISS_EVERY))) {
          return;
        }
        hissed.put(sound.at(), now);
      }
      Sounds.play(world, at, sound.cue(), original);
    }

    private void bomb(String kind, String bombId, Consumer<String> action) {
      action.accept(bombId);
      parts.recordings().event(now(), kind, bombId, "");
    }

    private void kill(MatchEffect.Kill kill) {
      for (var victim : kill.victims()) {
        // The rules already count these victims dead and credited the kill, so died() ignores
        // the death event that setHealth raises.
        withEntity(
            victim,
            player -> {
              if (!player.isDead()) {
                parts.combat().hurt(player, kill.cause(), player.getHealth());
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
            parts.combat().hurt(player, AttackType.END_OF_GAME, poison.amount());
            player.setHealth(Math.max(0, player.getHealth() - poison.amount()));
          });
    }

    private static void stripFood(Player player) {
      var inventory = player.getInventory();
      inventory.remove(Material.GOLDEN_APPLE);
      inventory.remove(Material.COOKED_BEEF);
    }

    /**
     * Craters go back and the bombs are cleared. With more than one map, the map is repaired the
     * next time it is prepared; a single map is verified now, before the next lobby opens.
     */
    private void revert() {
      parts.bombs().clear();
      var map = current;
      if (map == null) {
        resetDone();
        return;
      }
      map.revertCraters();
      if (rotation.playable().size() > 1) {
        map.markPlayed();
        resetDone();
        return;
      }
      map.verifyAndRepair(
          ok -> {
            if (!ok) {
              parts
                  .context()
                  .logger()
                  .error("Map {} could not be repaired; the lobby stays closed", map.id());
              ready = false;
              return;
            }
            resetDone();
          });
    }

    /** The flags are read again for the next match, and then the reset is done. */
    private void resetDone() {
      refreshFeatures(() -> handle(new MatchEvent.ResetDone()));
    }
  }

  /** A fresh vote over newly drawn candidates. */
  private MatchEvent ballotEvent() {
    var count = features.matchFlow() ? Ballot.SIZE : 1;
    var experience = experiences.freeze(match.matchId(), match.seed());
    return new MatchEvent.BallotOpened(
        rotation.candidates(count, experience.settings().maps()).stream()
            .map(
                map ->
                    new Ballot.Candidate(
                        map.id(), map.definition().name(), map.definition().author()))
            .toList());
  }

  /**
   * Loads, verifies and holds the chosen map, then tells the match. A result for a map the vote has
   * since moved away from is dropped by the match itself.
   */
  private void prepareMap(String mapId) {
    var map = rotation.byId(mapId);
    if (map.isEmpty()) {
      waiting.add(new MatchEvent.MapFailed(mapId));
      return;
    }
    preparing = map.orElseThrow();
    rotation.prepare(
        map.orElseThrow(),
        ok -> {
          var event =
              ok
                  ? new MatchEvent.MapReady(map.orElseThrow().definition(), now())
                  : new MatchEvent.MapFailed(mapId);
          var refused = handle(event);
          refused.ifPresent(
              error ->
                  parts
                      .context()
                      .logger()
                      .info("rwf: map {} prepared after the vote moved on ({})", mapId, error));
        });
  }

  /** The seconds the no-humans abort waits, for diagnostics. */
  Duration noHumansAbort() {
    return parts.config().match().noHumansAbort();
  }
}
