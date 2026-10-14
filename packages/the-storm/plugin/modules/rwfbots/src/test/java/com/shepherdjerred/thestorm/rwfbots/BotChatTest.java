package com.shepherdjerred.thestorm.rwfbots;

import static java.util.Objects.requireNonNull;
import static java.util.stream.Collectors.toUnmodifiableSet;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.app.ChatChannel;
import com.shepherdjerred.thestorm.chat.app.NpcChat;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.schedule.PaperScheduler;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.RwfBotsConfig;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.BotChat;
import com.shepherdjerred.thestorm.rwfbots.app.ChatGate;
import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.Chattiness;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotKind;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.TextComponent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.WorldCreator;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;
import org.mockbukkit.mockbukkit.world.WorldMock;

/**
 * Bot chat on MockBukkit through chat's NpcChat: a bot's kill is said, at most once, from the
 * killer's own kill lines in Global, framed with the ✦ marker and its team's mark, to the humans in
 * the rwf world (members and watchers) and to nobody outside it or ignoring the bot; a bomb call
 * goes to the bot's team only; with the managed flag off the bots say nothing.
 */
final class BotChatTest {

  private static final List<String> MOMENTS =
      List.of(
          "greet",
          "onKill",
          "onDeath",
          "onPlant",
          "onDefuse",
          "onWin",
          "onLoss",
          "onLastAlive",
          "taunt",
          "lobby");

  @TempDir Path directory;
  private @Nullable RwfBotsHarness running;

  @AfterEach
  void stop() {
    if (running != null) {
      running.close();
    }
  }

  /**
   * The shipped config with only {@code certain}'s line certain (base chance 1, every verbosity at
   * its 4x cap); every other moment silent. The body still reacts and types before delivery.
   */
  private static String only(String yaml, String certain) {
    var out = yaml;
    for (var moment : MOMENTS) {
      out =
          out.replaceFirst(
              "(?m)^    " + moment + ": [0-9.]+$",
              "    " + moment + ": " + (moment.equals(certain) ? "1.0" : "0.0"));
    }
    return out.replace(
            "verbosity: { quiet: 0.4, normal: 1.0, chatty: 1.6 }",
            "verbosity: { quiet: 4.0, normal: 4.0, chatty: 4.0 }")
        .replace("reactionMinMillis: 600", "reactionMinMillis: 0")
        .replace("reactionMaxMillis: 1800", "reactionMaxMillis: 0");
  }

  private RwfBotsHarness start(Consumer<RwfBotsHarness> before) {
    return start("onKill", before);
  }

  private RwfBotsHarness start(String certain, Consumer<RwfBotsHarness> before) {
    running = RwfBotsHarness.start(directory, yaml -> only(yaml, certain), before);
    return running;
  }

  private RwfBotsHarness harness() {
    return requireNonNull(running);
  }

  /** Registers team chat as rwf does: each combatant's team is everyone on it, bots included. */
  private static void teams(RwfBotsHarness harness) {
    var _ =
        harness.chat.registerMembership(
            ChatChannel.TEAM,
            speaker ->
                harness.match.snapshot().combatants().stream()
                    .filter(c -> c.id().uuid().equals(speaker))
                    .findFirst()
                    .flatMap(MatchSnapshot.CombatantView::team)
                    .map(
                        team ->
                            harness.match.snapshot().combatants().stream()
                                .filter(c -> c.team().equals(Optional.of(team)))
                                .map(c -> c.id().uuid())
                                .collect(toUnmodifiableSet())));
  }

  /** Alice (blue) and two bots, red then blue, live on the synthetic map. */
  private List<CombatantId.Bot> live(PlayerMock alice) {
    return live(alice, 5);
  }

  private List<CombatantId.Bot> live(PlayerMock alice, int settle) {
    return live(alice, settle, 2, () -> {});
  }

  private List<CombatantId.Bot> live(PlayerMock alice, int settle, int count, Runnable beforeLive) {
    var harness = harness();
    harness.match.fireJoin(new CombatantId.Human(alice.getUniqueId()), alice.getName());
    harness.match.fireMapChosen();
    var bots = harness.roster().fill(FakeMatch.MATCH_ID, count);
    for (var bot : bots) {
      harness.roster().spawn(bot, new Location(harness.world, 16.5, 1, 16.5));
      harness.match.fireJoin(bot, harness.roster().entity(bot).orElseThrow().getName());
    }
    harness.match.fighting(alice.getUniqueId(), TeamColor.BLUE, "trooper");
    // The wall keeps unrelated initial sightings out of these authored-line delivery fixtures.
    alice.teleport(new Location(harness.world, 30.5, 1, 5.5));
    var red = true;
    for (var bot : bots) {
      var kit = harness.match.member(bot.uuid()).kit().orElse("trooper");
      harness.match.fighting(bot.uuid(), red ? TeamColor.RED : TeamColor.BLUE, kit);
      harness
          .roster()
          .entity(bot)
          .orElseThrow()
          .teleport(new Location(harness.world, red ? 5.5 : 26.5, 1, 5.5));
      red = !red;
    }
    beforeLive.run();
    harness.match.phase(MatchSnapshot.PhaseKind.LIVE);
    harness.match.fireTick();
    harness.ticks(settle);
    return bots;
  }

  private static List<String> heard(PlayerMock player) {
    var lines = new ArrayList<String>();
    for (var message = player.nextComponentMessage();
        message != null;
        message = player.nextComponentMessage()) {
      lines.add(PlainTextComponentSerializer.plainText().serialize(message));
    }
    return lines;
  }

  private void killAlice(PlayerMock alice, CombatantId.Bot killer) {
    var harness = harness();
    harness.match.kill(alice.getUniqueId());
    harness.match.fire(
        new MatchEvent.Died(
            new CombatantId.Human(alice.getUniqueId()),
            Optional.of(killer),
            AttackType.MELEE,
            FakeMatch.T0),
        List.of());
    speechTicks(1);
    assertThat(heard(alice))
        .as("a kill line cannot arrive before its reaction and typing")
        .isEmpty();
    speechTicks(100);
  }

  /** Advance authored speech and fresh bodies without adding autonomous movement or reports. */
  private void speechTicks(int count) {
    speechTicks(harness().paper().chat().orElseThrow(), count);
  }

  private void speechTicks(BotChat chat, int count) {
    var harness = harness();
    var session = harness.paper().roster().session().orElseThrow();
    for (var step = 0; step < count; step++) {
      harness.clock.advance(Duration.ofMillis(50));
      var tick = Duration.between(FakeMatch.T0, harness.clock.instant()).toMillis() / 50;
      chat.tick(
          Optional.of(session.capture().capture(tick, MatchState.of(harness.match.snapshot()))));
    }
  }

  private String name(CombatantId.Bot bot) {
    return harness().paper().roster().bot(bot.uuid()).orElseThrow().name();
  }

  @Test
  void nonurgentStartCannotSuppressAnAssignedTravellersControllerFrame() {
    var harness = start("greet", h -> {});
    var controller = new SpeechController();
    harness.paper().roster().harness().attachAuthored(1, controller);
    var alice = harness.player("Alice");
    var watcher = harness.player("Watcher");
    watcher.teleport(new Location(harness.world, 5.5, 1, 7.5));
    var bots =
        live(
            alice,
            0,
            1,
            () -> {
              // No enemy observation can produce an unrelated, valid tactical typing pause.
              alice.teleport(new Location(harness.world, 200.5, 1, 200.5));
              harness.clock.advance(Duration.ofSeconds(30));
            });
    var chat = harness.paper().chat().orElseThrow();
    assertThat(harness.paper().roster().live())
        .allMatch(body -> body.drafted().personality().lines().greet().size() > 1);
    assertThat(harness.paper().loop().board().thoughts()).isEmpty();
    assertThat(bots).allMatch(bot -> !chat.typing(bot.uuid()));

    harness.tick();
    assertThat(controller.frames).hasSize(1);
    assertThat(bots).allMatch(bot -> !chat.typing(bot.uuid()));
    var travelFrames = 0;
    var moving = false;
    for (var tick = 0; tick < 100; tick++) {
      controller.frames.clear();
      harness.tick();
      travelFrames += controller.assertTravelling(harness);
      moving |=
          controller.frames.stream()
              .flatMap(frame -> frame.authored().commands().stream())
              .anyMatch(BodyCommand.MoveToward.class::isInstance);
    }
    assertThat(travelFrames).as("real published travel assignments were exercised").isPositive();
    assertThat(moving).as("speech admission left actual walking commands intact").isTrue();
  }

  private static final class SpeechController implements CombatHarness.Controller {
    private final List<CombatHarness.Frame> frames = new ArrayList<>();

    @Override
    public void captureTick(long tick) {}

    @Override
    public ReflexInput input(ReflexInput authored, NavArtifact nav) {
      throw new IllegalStateException("ordinary speech fixtures cannot replace reflex inputs");
    }

    @Override
    public List<BodyCommand> commands(CombatHarness.Frame frame) {
      frames.add(frame);
      return frame.authored().commands();
    }

    int assertTravelling(RwfBotsHarness harness) {
      var session = harness.paper().roster().session().orElseThrow();
      var travellers =
          harness.paper().loop().board().thoughts().entrySet().stream()
              .filter(entry -> !entry.getValue().decision().waypoints().isEmpty())
              .map(entry -> session.ids().uuid(entry.getKey()).orElseThrow())
              .toList();
      for (var uuid : travellers) {
        assertThat(harness.paper().chat().orElseThrow().typing(uuid))
            .as("a traveller cannot type casual start/idle speech")
            .isFalse();
        assertThat(frames)
            .as("the ordinary controller still receives this traveller's actual frame")
            .anyMatch(frame -> frame.body().equals(uuid));
      }
      return travellers.size();
    }
  }

  @Test
  void aRealStationaryDefenderStillTypesAndPublishesCasualSpeechOnce() {
    var harness = start("onKill", h -> turtles());
    var alice = harness.player("Alice");
    var guard = prepareStationaryDefender(harness, alice);
    var speech = freshStartChat(harness);
    try {
      var existingDisplays =
          harness.world.getEntities().stream()
              .filter(org.bukkit.entity.TextDisplay.class::isInstance)
              .map(org.bukkit.entity.Entity::getUniqueId)
              .collect(toUnmodifiableSet());
      authoredStart(speech, guard);
      heard(alice);
      speechTicks(speech, 1);
      assertThat(speech.typing(guard)).as("reaction is still required in a safe hold").isFalse();
      assertThat(heard(alice)).isEmpty();
      speechTicks(speech, 19);
      assertThat(speech.typing(guard)).as("the safe defender actually spends time typing").isTrue();
      assertThat(heard(alice)).isEmpty();
      var indicator = ownedIndicator(harness, guard, existingDisplays);
      speechTicks(speech, 100);
      assertThat(speech.typing(guard)).isFalse();
      assertThat(heard(alice)).singleElement().asString().startsWith("[G][● ");
      speechTicks(speech, 100);
      assertThat(heard(alice)).as("one authored greeting is delivered once").isEmpty();
      assertThat(harness.server.getEntity(indicator))
          .as("this speech's indicator was removed")
          .isNull();
    } finally {
      speech.close();
    }
  }

  private static UUID ownedIndicator(
      RwfBotsHarness harness, UUID speaker, java.util.Set<UUID> existing) {
    var body = harness.paper().roster().bodies().entity(speaker).orElseThrow();
    var position = requireNonNull(body.getLocation()).add(0, 2.5, 0);
    var displays =
        harness.world.getEntities().stream()
            .filter(org.bukkit.entity.TextDisplay.class::isInstance)
            .filter(display -> !existing.contains(display.getUniqueId()))
            .filter(display -> requireNonNull(display.getLocation()).distanceSquared(position) == 0)
            .map(org.bukkit.entity.Entity::getUniqueId)
            .toList();
    assertThat(displays).as("this speaker created one typing indicator").hasSize(1);
    return displays.getFirst();
  }

  private UUID prepareStationaryDefender(RwfBotsHarness harness, PlayerMock alice) {
    live(alice, 1, 8, () -> {});
    var session = harness.paper().roster().session().orElseThrow();
    var anchor = anchor(harness);
    var uuid = session.ids().uuid(anchor.id()).orElseThrow();
    var team = harness.match.member(uuid).team().orElseThrow();
    var away =
        harness.match.map().teams().stream()
            .filter(side -> side.color() != team)
            .findFirst()
            .orElseThrow()
            .spawns()
            .getFirst()
            .position();
    for (var member : harness.match.snapshot().combatants()) {
      if (member.id().uuid().equals(uuid)) continue;
      var position =
          member.team().filter(team::equals).isPresent()
              ? new Location(harness.world, away.x(), away.y(), away.z())
              : new Location(harness.world, 200.5, 1, 200.5);
      requireNonNull(harness.server.getPlayer(member.id().uuid())).teleport(position);
    }
    harness
        .paper()
        .roster()
        .bodies()
        .entity(uuid)
        .orElseThrow()
        .teleport(
            new Location(harness.world, anchor.pos().x(), anchor.pos().y(), anchor.pos().z()));
    for (var step = 0; step < 120 && !holds(harness, anchor.id()); step++) {
      harness.paper().loop().requestReplan(anchor.id());
      harness.tick();
    }
    assertThat(holds(harness, anchor.id()))
        .as("the real anchor settled at its published slot, away from enemies and moving allies")
        .isTrue();
    return uuid;
  }

  private record Anchor(
      com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId id,
      com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3 pos) {}

  private static Anchor anchor(RwfBotsHarness harness) {
    for (var plan : harness.paper().loop().board().plans().values()) {
      for (var assignment : plan.assignment().entrySet()) {
        var slot = plan.slotOf(assignment.getKey()).orElseThrow();
        if (slot.kind() == SlotKind.ANCHOR) return new Anchor(assignment.getKey(), slot.pos());
      }
    }
    throw new IllegalStateException("the actual team plan did not assign a defensive anchor");
  }

  private static boolean holds(
      RwfBotsHarness harness, com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId bot) {
    return harness
        .paper()
        .loop()
        .board()
        .of(bot)
        .map(thought -> thought.decision())
        .filter(decision -> decision.option() == Option.HOLD_SLOT)
        .filter(decision -> decision.waypoints().isEmpty())
        .filter(decision -> decision.target().isEmpty())
        .filter(decision -> decision.ability().isEmpty())
        .isPresent();
  }

  private void turtles() {
    try (var files = Files.list(directory.resolve("rwfbots/personalities"))) {
      for (var file : files.toList()) {
        var text = Files.readString(file);
        Files.writeString(file, text.replaceAll("(?m)^archetype: [a-z_]+$", "archetype: turtle"));
      }
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  private BotChat freshStartChat(RwfBotsHarness harness) {
    var configuration = directory.resolve("stationary-chat.yml");
    try {
      Files.writeString(
          configuration, only(Files.readString(directory.resolve(RwfBotsModule.CONFIG)), "greet"));
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
    var owner = requireNonNull(harness.server.getPluginManager().getPlugin("TheStorm"));
    var speech =
        new BotChat(
            new BotChat.Parts(
                ConfigFiles.load(configuration, RwfBotsConfig.class).chat().toSettings(),
                Duration.ofSeconds(30),
                new EnabledChat(),
                harness.paper().roster(),
                List.of(harness.world),
                harness.services.require(NpcChat.class),
                new PaperScheduler(owner),
                harness.clock,
                owner.getComponentLogger()));
    speech.compose(harness.paper().loop(), owner);
    speech.start(harness.match);
    harness.tick();
    assertThat(speech.enabled()).isTrue();
    return speech;
  }

  private void authoredStart(BotChat speech, UUID speaker) {
    var snapshot = harness().match.snapshot();
    var selected =
        snapshot.combatants().stream()
            .filter(combatant -> combatant.id().uuid().equals(speaker))
            .toList();
    for (var phase : List.of(MatchSnapshot.PhaseKind.COUNTDOWN, MatchSnapshot.PhaseKind.LIVE)) {
      speech.accept(
          new MatchNotification(
              MatchEvent.Tick.at(harness().clock.instant()),
              List.of(),
              new MatchSnapshot(
                  snapshot.matchId(),
                  phase,
                  snapshot.now(),
                  snapshot.mapId(),
                  snapshot.teams(),
                  selected,
                  phase == MatchSnapshot.PhaseKind.LIVE ? snapshot.bombs() : List.of(),
                  snapshot.poison(),
                  snapshot.outcome(),
                  snapshot.startsAt(),
                  snapshot.ballot())));
    }
  }

  private static final class EnabledChat implements ChatGate {
    @Override
    public CompletableFuture<Boolean> enabled() {
      return CompletableFuture.completedFuture(true);
    }

    @Override
    public void close() {}
  }

  @Test
  void aBotsKillIsSaidOnceFromItsKillLinesToTheRwfWorldOnly() {
    var harness = start(h -> {});
    var alice = harness.player("Alice");
    var watcher = harness.player("Carol");
    watcher.teleport(new Location(harness.world, 16.5, 4, 16.5));
    var elsewhere = new WorldMock(new WorldCreator("world"));
    harness.server.addWorld(elsewhere);
    var bob = harness.player("Bob");
    bob.teleport(new Location(elsewhere, 0, 5, 0));
    var bots = live(alice);
    assertThat(harness.paper().chat().orElseThrow().enabled()).isTrue();
    heard(alice);
    heard(watcher);
    heard(bob);

    var killer = bots.getFirst();
    var body = harness.paper().roster().bot(killer.uuid()).orElseThrow();
    var personality = body.drafted().personality();
    assertThat(
            Chattiness.chance(
                ConfigFiles.load(directory.resolve(RwfBotsModule.CONFIG), RwfBotsConfig.class)
                    .chat()
                    .toSettings(),
                personality,
                Lines.Moment.ON_KILL,
                Chattiness.Context.PLAIN))
        .as("the test config makes the kill line certain")
        .isEqualTo(1);
    killAlice(alice, killer);

    var expected =
        personality.lines().onKill().stream()
            .map(
                line ->
                    "[G][● "
                        + body.name()
                        + " ✦]: "
                        + line.replace("{victim}", "Alice").replace("{team}", "Red Team"))
            .toList();
    var aliceHeard = heard(alice);
    assertThat(aliceHeard).singleElement().isIn(expected);
    assertThat(heard(watcher)).as("watchers in the rwf world hear it too").isEqualTo(aliceHeard);
    assertThat(heard(bob)).as("nobody outside the rwf world hears bots").isEmpty();
    for (var bot : bots) {
      var entity = (PlayerMock) harness.roster().entity(bot).orElseThrow();
      assertThat(heard(entity)).as("bot bodies are not an audience").isEmpty();
    }

    speechTicks(40);
    assertThat(heard(alice)).as("one kill, one line").isEmpty();
  }

  @Test
  void theLineIsFramedWithTheMarkerAndTheTeamColour() {
    var harness = start(h -> {});
    var alice = harness.player("Alice");
    var bots = live(alice);
    heard(alice);

    killAlice(alice, bots.getFirst());

    var message = requireNonNull(alice.nextComponentMessage());
    assertThat(PlainTextComponentSerializer.plainText().serialize(message))
        .startsWith("[G][● " + name(bots.getFirst()) + " ✦]: ");
    assertThat(colourOf(message, "●")).contains(NamedTextColor.RED);
  }

  @Test
  void aPlayerWhoIgnoresABotDoesNotHearIt() {
    var harness = start(h -> {});
    var alice = harness.player("Alice");
    var carol = harness.player("Carol");
    carol.teleport(new Location(harness.world, 16.5, 4, 16.5));
    var bots = live(alice);
    var killer = bots.getFirst();
    requireNonNull(harness.chatService)
        .ignore(
            carol.getUniqueId(), new ChatProfile.IgnoreTarget(killer.uuid(), name(killer), false));
    heard(alice);
    heard(carol);

    killAlice(alice, killer);

    assertThat(heard(alice)).hasSize(1);
    assertThat(heard(carol)).isEmpty();
  }

  @Test
  void aPlantIsCalledInTeamChatToTheTeamOnly() {
    var harness = start("onPlant", BotChatTest::teams);
    var alice = harness.player("Alice");
    var bots = live(alice);
    var blueBot = bots.get(1);
    var redBody = (PlayerMock) harness.roster().entity(bots.getFirst()).orElseThrow();
    heard(alice);

    harness.match.redArmed(true);
    harness.match.fire(
        new MatchEvent.BombClicked(blueBot, FakeMatch.RED_BOMB, FakeMatch.T0),
        List.of(new MatchEffect.RecordStat(blueBot, "Armed")));
    speechTicks(1);
    assertThat(heard(alice)).as("the team call is typed before it is sent").isEmpty();
    speechTicks(100);

    assertThat(heard(alice))
        .as("Alice is blue, so she hears her teammate's call")
        .singleElement()
        .asString()
        .startsWith("[Tm][● " + name(blueBot) + " ✦]: ");
    assertThat(heard(redBody)).as("bot bodies are never an audience").isEmpty();
  }

  @Test
  void aCallIsNotHeardByTheOtherTeam() {
    var harness = start("onPlant", BotChatTest::teams);
    var alice = harness.player("Alice");
    var redBot = live(alice).getFirst();
    var redViewer = harness.player("Robin");
    harness.match.fireJoin(new CombatantId.Human(redViewer.getUniqueId()), redViewer.getName());
    harness.match.fighting(redViewer.getUniqueId(), TeamColor.RED, "trooper");
    redViewer.teleport(new Location(harness.world, 1.5, 1, 5.5));
    heard(alice);
    heard(redViewer);

    harness.match.blueArmed(true);
    harness.match.fire(
        new MatchEvent.BombClicked(redBot, FakeMatch.BLUE_BOMB, FakeMatch.T0),
        List.of(new MatchEffect.RecordStat(redBot, "Armed")));
    assertThat(heard(alice)).as("the opponent's plant has not completed typing").isEmpty();
    speechTicks(100);

    assertThat(heard(alice)).as("a red bot's call stays with the red team").isEmpty();
    assertThat(heard(redViewer))
        .as("the completed plant call reaches its own team")
        .singleElement()
        .asString()
        .startsWith("[Tm][● " + name(redBot) + " ✦]: ");
  }

  @Test
  void withTheFlagOffBotsSayNothing() {
    var harness = start(h -> h.chatFlag.set(false));
    var alice = harness.player("Alice");
    var bots = live(alice);
    heard(alice);
    assertThat(harness.paper().chat().orElseThrow().enabled()).isFalse();

    killAlice(alice, bots.getFirst());

    assertThat(heard(alice)).isEmpty();
  }

  @Test
  void deathCancelsAnUnfinishedLineAndRemovesItsTypingIndicator() {
    var harness = start(h -> {});
    var alice = harness.player("Alice");
    var killer = live(alice).getFirst();
    heard(alice);
    harness.match.kill(alice.getUniqueId());
    harness.match.fire(
        new MatchEvent.Died(
            new CombatantId.Human(alice.getUniqueId()),
            Optional.of(killer),
            AttackType.MELEE,
            FakeMatch.T0),
        List.of());
    speechTicks(20);
    var chat = harness.paper().chat().orElseThrow();
    assertThat(chat.typing(killer.uuid())).isTrue();
    assertThat(harness.world.getEntitiesByClass(org.bukkit.entity.TextDisplay.class)).isNotEmpty();
    assertThat(harness.world.getEntitiesByClass(org.bukkit.entity.TextDisplay.class))
        .allMatch(display -> !display.isVisibleByDefault() && !alice.canSee(display));
    assertThat(heard(alice)).isEmpty();
    harness.match.kill(killer.uuid());
    harness.match.fire(
        new MatchEvent.Died(killer, Optional.empty(), AttackType.MELEE, FakeMatch.T0), List.of());
    assertThat(chat.typing(killer.uuid())).isFalse();
    assertThat(harness.world.getEntitiesByClass(org.bukkit.entity.TextDisplay.class)).isEmpty();
    speechTicks(100);
    assertThat(heard(alice)).as("death discards the unfinished call").isEmpty();
  }

  /** The colour of the first component in {@code message} whose own text is {@code text}. */
  private static Optional<TextColor> colourOf(Component message, String text) {
    if (message instanceof TextComponent component && component.content().equals(text)) {
      return Optional.ofNullable(component.color());
    }
    for (var child : message.children()) {
      var found = colourOf(child, text);
      if (found.isPresent()) {
        return found;
      }
    }
    return Optional.empty();
  }
}
