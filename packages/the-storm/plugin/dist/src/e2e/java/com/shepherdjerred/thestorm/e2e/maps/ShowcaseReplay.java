package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.TheStormPlugin;
import com.shepherdjerred.thestorm.rwf.app.BotRoster;
import com.shepherdjerred.thestorm.rwf.app.ExperienceSettings;
import com.shepherdjerred.thestorm.rwf.app.MatchEvents;
import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.ShowcaseControl;
import com.shepherdjerred.thestorm.rwf.app.TacticalCasting;
import com.shepherdjerred.thestorm.rwf.app.map.MapLoading;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwf.app.view.Point;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.PersonalityFiles;
import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import com.shepherdjerred.thestorm.rwfbots.app.Director;
import com.shepherdjerred.thestorm.rwfbots.app.MatchCompetence;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.director.SkillScale;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;
import org.jspecify.annotations.Nullable;

/** One retained native opening cohort; observes authored commands without replacing behavior. */
final class ShowcaseReplay implements CombatHarness.Controller {
  private static final long SEED = 3820972541116702293L;
  private static final String ORIGINAL = "d3b07b36-0f40-47ff-880f-1e509bc41c17";
  private static final String MAP_HASH =
      "03f6daeb430aa9da0dfdcb472bfdab7b7b5a69741841d7a93444efbd53a85171";
  private static final int CAPTURE_TICKS = 240;
  private static final ExperienceSettings EXPERIENCE =
      new ExperienceSettings(
          ExperienceSettings.Difficulty.HARD,
          ExperienceSettings.Style.VARIED,
          ExperienceSettings.Variety.HIGH,
          java.util.Set.of(),
          java.util.Set.of());
  private static final List<Seat> COHORT =
      List.of(
          new Seat("lyxskaertv", Kit.SHORTBOW, "blue"),
          new Seat("swiftpickaxe68", Kit.LONGBOW, "red"),
          new Seat("phantompickaxe3", Kit.REWIND, "red"),
          new Seat("thezaxmost", Kit.TROOPER, "blue"),
          new Seat("daxgraixbandit", Kit.TROOPER, "red"),
          new Seat("skozskaethpvp", Kit.SHORTBOW, "blue"),
          new Seat("luckymaikrak", Kit.TROOPER, "blue"),
          new Seat("sneakybadger09", Kit.TROOPER, "red"),
          new Seat("sneakyninja61", Kit.TROOPER, "blue"),
          new Seat("rexaeshtoush-37", Kit.TROOPER, "red"),
          new Seat("kynjour-07", Kit.LONGBOW, "red"),
          new Seat("daikarvuk-59", Kit.TROOPER, "blue"),
          new Seat("thexiozjouzdim", Kit.REWIND, "blue"),
          new Seat("slimesniper2", Kit.TROOPER, "red"),
          new Seat("ziolkrukgaming", Kit.LONGBOW, "blue"),
          new Seat("vipergolem6", Kit.TROOPER, "red"));

  private final TheStormPlugin storm;
  private final List<Tick> ticks = new ArrayList<>();
  private final Map<UUID, Body> pending = new LinkedHashMap<>();
  private Optional<UUID> match = Optional.empty();
  private Optional<MatchEvents.Subscription> subscription = Optional.empty();
  private long liveTick = -1;
  private String phase = "unused";

  private record Seat(String personality, Kit kit, String team) {}

  private record Identity(int slot, String personality, UUID body, String team, String kit) {}

  private record Pose(
      Point at, Point velocity, double health, double fallDistance, boolean sprint) {}

  private record Activity(boolean typingIndicator, boolean activeItem, boolean casting) {}

  private record Intent(
      long decisionTick,
      String plan,
      String option,
      List<String> commands,
      List<String> waypoints) {}

  private record Body(Identity identity, Pose pose, Activity activity, @Nullable Intent intent) {
    Body withIntent(Intent next) {
      return new Body(identity, pose, activity, next);
    }
  }

  private record Tick(long serverTick, long authoredTick, long liveTick, List<Body> bodies) {}

  ShowcaseReplay(TheStormPlugin storm) {
    this.storm = storm;
  }

  Map<String, Object> start() {
    if (match.isPresent()) throw new IllegalStateException("original cohort already replayed");
    var lobby = current();
    if (lobby.phase() != MatchState.Phase.LOBBY || !lobby.combatants().isEmpty())
      throw new IllegalStateException("original cohort requires an empty lobby");
    if (lobby.mapId().filter(map -> !map.equals("training-yard")).isPresent())
      throw new IllegalStateException("original cohort requires training-yard");
    var terrain =
        storm.service(MapLoading.class).states().stream()
            .filter(map -> map.id().equals("training-yard"))
            .findFirst()
            .orElseThrow();
    if (!terrain.blocksSha256().equals(MAP_HASH))
      throw new IllegalStateException("original cohort terrain differs");
    var catalog = PersonalityFiles.load(storm.getDataFolder().toPath());
    var draft =
        COHORT.stream()
            .map(
                seat -> {
                  var personality = catalog.byId(seat.personality()).orElseThrow();
                  return new Director.Drafted(
                      personality,
                      seat.kit(),
                      MatchCompetence.levers(personality, EXPERIENCE, SEED),
                      new Rating(SkillScale.toMu(personality.skill()), Rating.DEFAULT.sigma()),
                      MatchCompetence.style(personality, EXPERIENCE));
                })
            .toList();
    var harness = storm.service(CombatHarness.class);
    harness.attachAuthored(draft, this);
    match = Optional.of(lobby.matchId());
    subscription =
        Optional.of(
            storm
                .service(MatchEvents.class)
                .subscribe(event -> changed(MatchState.of(event.after()))));
    var refused =
        storm.service(ShowcaseControl.class).startSeeded(lobby.matchId(), COHORT.size(), SEED);
    if (refused.isPresent()) {
      detach();
      throw new IllegalStateException(refused.orElseThrow());
    }
    phase = current().phase().name();
    return status();
  }

  Map<String, Object> status() {
    return Map.of(
        "originalMatch",
        ORIGINAL,
        "match",
        match.map(UUID::toString).orElse(""),
        "seed",
        Long.toString(SEED),
        "settings",
        EXPERIENCE.canonical(SEED),
        "phase",
        phase,
        "chatSeedPinned",
        false,
        "nativeAcceptance",
        "not-exposed",
        "roster",
        COHORT,
        "ticks",
        List.copyOf(ticks));
  }

  Map<String, Object> stop() {
    var owned = match.orElseThrow(() -> new IllegalStateException("no original cohort replay"));
    if (current().matchId().equals(owned) && current().phase() == MatchState.Phase.LIVE) {
      storm
          .service(ShowcaseControl.class)
          .stop(owned)
          .ifPresent(
              refusal -> {
                throw new IllegalStateException(refusal);
              });
    }
    detach();
    return status();
  }

  private MatchState current() {
    return storm.service(MatchView.class).current().map(MatchState::of).orElseThrow();
  }

  private void changed(MatchState state) {
    if (match.filter(state.matchId()::equals).isEmpty()) return;
    phase = state.phase().name();
    if (state.phase() == MatchState.Phase.LIVE && liveTick < 0) {
      verify(state);
      liveTick = storm.getServer().getCurrentTick();
    }
    if (state.phase() == MatchState.Phase.ENDED || state.phase() == MatchState.Phase.RESETTING)
      detach();
  }

  private void verify(MatchState state) {
    if (!state.mapId().filter("training-yard"::equals).isPresent())
      throw new IllegalStateException("original cohort map differs");
    var experience = storm.service(MatchView.class).experience(state.matchId()).orElseThrow();
    if (experience.seed() != SEED || !experience.settings().equals(EXPERIENCE))
      throw new IllegalStateException("original cohort experience differs");
    if (state.combatants().size() != COHORT.size())
      throw new IllegalStateException("original cohort roster size differs");
    for (var slot = 0; slot < COHORT.size(); slot++) {
      var seat = COHORT.get(slot);
      var fighter = state.combatants().get(slot);
      if (!fighter.personalityId().filter(seat.personality()::equals).isPresent()
          || !fighter.team().filter(seat.team()::equals).isPresent()
          || !fighter.kit().filter(seat.kit().name().toLowerCase(Locale.ROOT)::equals).isPresent())
        throw new IllegalStateException("original cohort slot " + slot + " differs");
    }
    if (storm.service(CombatHarness.class).controlled(state.matchId()))
      throw new IllegalStateException("original cohort entered controlled mechanics");
  }

  private void detach() {
    subscription.ifPresent(MatchEvents.Subscription::close);
    subscription = Optional.empty();
    storm.service(CombatHarness.class).detach();
  }

  @Override
  public void captureTick(long tick) {
    pending.clear();
    if (liveTick < 0 || storm.getServer().getCurrentTick() - liveTick >= CAPTURE_TICKS) return;
    var state = current();
    var roster = storm.service(BotRoster.class);
    for (var slot = 0; slot < state.combatants().size(); slot++) {
      var fighter = state.combatants().get(slot);
      if (!fighter.alive()) continue;
      var personality = fighter.personalityId().orElseThrow();
      var player =
          roster
              .entity(
                  new com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId.Bot(
                      personality, fighter.uuid()))
              .orElseThrow();
      var identity =
          new Identity(
              slot,
              personality,
              fighter.uuid(),
              fighter.team().orElseThrow(),
              fighter.kit().orElseThrow());
      pending.put(fighter.uuid(), new Body(identity, pose(player), activity(player), null));
    }
  }

  private static Pose pose(Player player) {
    var at = Objects.requireNonNull(player.getLocation());
    var velocity = player.getVelocity();
    return new Pose(
        new Point(at.getX(), at.getY(), at.getZ()),
        new Point(velocity.getX(), velocity.getY(), velocity.getZ()),
        player.getHealth(),
        player.getFallDistance(),
        player.isSprinting());
  }

  private Activity activity(Player player) {
    var head = Objects.requireNonNull(player.getLocation()).add(0, 2.5, 0);
    var typing =
        player.getWorld().getEntitiesByClass(TextDisplay.class).stream()
            .anyMatch(display -> typing(display, head));
    return new Activity(
        typing,
        player.hasActiveItem(),
        storm.service(TacticalCasting.class).stationary(player.getUniqueId()));
  }

  private static boolean typing(TextDisplay display, Location head) {
    return PlainTextComponentSerializer.plainText().serialize(display.text()).equals("typing…")
        && Objects.requireNonNull(display.getLocation()).distanceSquared(head) < 0.000001;
  }

  @Override
  public void finishTick(long tick) {
    if (pending.isEmpty()) return;
    ticks.add(
        new Tick(
            storm.getServer().getCurrentTick(), tick, liveTick, List.copyOf(pending.values())));
    if (ticks.size() > CAPTURE_TICKS)
      throw new IllegalStateException(
          "original cohort diagnostics exceeded their native tick bound");
  }

  @Override
  public ReflexInput input(ReflexInput authored, NavArtifact nav) {
    throw new IllegalStateException("ordinary cohort must retain the original reflex input");
  }

  @Override
  public List<BodyCommand> commands(CombatHarness.Frame frame) {
    var captured = pending.get(frame.body());
    if (captured != null) {
      var decision = frame.input().decision();
      var intent =
          new Intent(
              decision.snapshotTick(),
              decision.planLabel(),
              decision.option().name(),
              frame.authored().commands().stream().map(Object::toString).toList(),
              decision.waypoints().stream().map(Object::toString).toList());
      pending.put(frame.body(), captured.withIntent(intent));
    }
    return frame.authored().commands();
  }
}
