package com.shepherdjerred.thestorm.rwfbots;

import static java.util.Objects.requireNonNull;
import static java.util.stream.Collectors.toUnmodifiableSet;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.app.ChatChannel;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwfbots.adapter.content.RwfBotsConfig;
import com.shepherdjerred.thestorm.rwfbots.domain.chat.Chattiness;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
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
   * its 4x cap) and said the moment it happens; every other moment silent.
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
    var harness = harness();
    harness.match.fireJoin(new CombatantId.Human(alice.getUniqueId()), alice.getName());
    harness.match.fireMapChosen();
    var bots = harness.roster().fill(FakeMatch.MATCH_ID, 2);
    for (var bot : bots) {
      harness.roster().spawn(bot, new Location(harness.world, 16.5, 1, 16.5));
      harness.match.fireJoin(bot, harness.roster().entity(bot).orElseThrow().getName());
    }
    harness.match.fighting(alice.getUniqueId(), TeamColor.BLUE, "trooper");
    alice.teleport(new Location(harness.world, 30.5, 1, 30.5));
    var red = true;
    for (var bot : bots) {
      var kit = harness.match.member(bot.uuid()).kit().orElse("trooper");
      harness.match.fighting(bot.uuid(), red ? TeamColor.RED : TeamColor.BLUE, kit);
      red = !red;
    }
    harness.match.phase(MatchSnapshot.PhaseKind.LIVE);
    harness.match.fireTick();
    harness.ticks(5);
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
    harness.tick();
  }

  private String name(CombatantId.Bot bot) {
    return harness().paper().roster().bot(bot.uuid()).orElseThrow().name();
  }

  @Test
  void aBotsKillIsSaidOnceFromItsKillLinesToTheRwfWorldOnly() {
    var harness = start(h -> {});
    var alice = harness.server.addPlayer("Alice");
    var watcher = harness.server.addPlayer("Carol");
    watcher.teleport(new Location(harness.world, 16.5, 4, 16.5));
    var elsewhere = new WorldMock(new WorldCreator("world"));
    harness.server.addWorld(elsewhere);
    var bob = harness.server.addPlayer("Bob");
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

    harness.ticks(40);
    assertThat(heard(alice)).as("one kill, one line").isEmpty();
  }

  @Test
  void theLineIsFramedWithTheMarkerAndTheTeamColour() {
    var harness = start(h -> {});
    var alice = harness.server.addPlayer("Alice");
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
    var alice = harness.server.addPlayer("Alice");
    var carol = harness.server.addPlayer("Carol");
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
    var alice = harness.server.addPlayer("Alice");
    var bots = live(alice);
    var blueBot = bots.get(1);
    var redBody = (PlayerMock) harness.roster().entity(bots.getFirst()).orElseThrow();
    heard(alice);

    harness.match.redArmed(true);
    harness.match.fire(
        new MatchEvent.BombClicked(blueBot, FakeMatch.RED_BOMB, FakeMatch.T0),
        List.of(new MatchEffect.RecordStat(blueBot, "Armed")));
    harness.tick();

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
    var alice = harness.server.addPlayer("Alice");
    var redBot = live(alice).getFirst();
    heard(alice);

    harness.match.blueArmed(true);
    harness.match.fire(
        new MatchEvent.BombClicked(redBot, FakeMatch.BLUE_BOMB, FakeMatch.T0),
        List.of(new MatchEffect.RecordStat(redBot, "Armed")));
    harness.tick();

    assertThat(heard(alice)).as("a red bot's call stays with the red team").isEmpty();
  }

  @Test
  void withTheFlagOffBotsSayNothing() {
    var harness = start(h -> h.chatFlag.set(false));
    var alice = harness.server.addPlayer("Alice");
    var bots = live(alice);
    heard(alice);
    assertThat(harness.paper().chat().orElseThrow().enabled()).isFalse();

    killAlice(alice, bots.getFirst());

    assertThat(heard(alice)).isEmpty();
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
