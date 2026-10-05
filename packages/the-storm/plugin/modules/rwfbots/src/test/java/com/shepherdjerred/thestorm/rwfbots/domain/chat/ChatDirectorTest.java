package com.shepherdjerred.thestorm.rwfbots.domain.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines.Moment;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Voice;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import org.assertj.core.data.Offset;
import org.junit.jupiter.api.Test;

final class ChatDirectorTest {

  private static final Instant T0 = Instant.parse("2026-10-04T12:00:00Z");
  private static final String RED = "Red Team";
  private static final String BLUE = "Blue Team";
  private static final Offset<Double> CLOSE = Offset.offset(1e-9);

  private static final Lines LINES =
      new Lines(
          List.of("hi from {team}", "hello"),
          List.of("got {victim}", "easy, {victim}", "bye {victim}"),
          List.of("nice shot {killer}", "ow", "lag"),
          List.of("{bomb} is lit", "boom soon"),
          List.of("{bomb} is safe", "not today"),
          List.of("gg {team}", "we did it"),
          List.of("next time", "gg wp"),
          List.of("just me now", "clutch time"),
          List.of("come at me", "too slow", "where are you"),
          List.of("ready up", "which kit?", "go {team}", "gl all"));

  private static final UUID ALICE = new UUID(0, 1);
  private static final UUID BOB = new UUID(0, 2);
  private static final UUID REDBOT = new UUID(0, 11);
  private static final UUID REDBOT2 = new UUID(0, 12);
  private static final UUID BLUEBOT = new UUID(0, 21);

  /** Settings where every chance is {@code chance} and lines are said the moment they happen. */
  static ChatSettings settings(double chance) {
    var chances = new EnumMap<Moment, Double>(Moment.class);
    for (var moment : Moment.values()) {
      chances.put(moment, chance);
    }
    return new ChatSettings(
        chances,
        Map.of(
            Voice.Verbosity.QUIET, 1.0, Voice.Verbosity.NORMAL, 1.0, Voice.Verbosity.CHATTY, 1.0),
        2,
        Duration.ofSeconds(20),
        Duration.ofSeconds(10),
        4,
        Duration.ofSeconds(1),
        Duration.ZERO,
        Duration.ZERO,
        Duration.ofSeconds(5),
        Duration.ofSeconds(8),
        Duration.ofSeconds(30));
  }

  static Personality bot(String id, Archetype archetype, Set<Quirk> quirks, List<String> rivals) {
    return voiced(
        id,
        new Traits(archetype, quirks, rivals),
        new Voice(List.of("dry"), Voice.Verbosity.NORMAL, "plain"));
  }

  static Personality toned(String id, String tone) {
    return voiced(
        id,
        new Traits(Archetype.FLANKER, Set.of(Quirk.SPINS), List.of()),
        new Voice(List.of(tone), Voice.Verbosity.NORMAL, "plain"));
  }

  /** What sets a test bot apart besides its voice. */
  private record Traits(Archetype archetype, Set<Quirk> quirks, List<String> rivals) {}

  private static Personality voiced(String id, Traits traits, Voice voice) {
    var base = Fixtures.personality(id, id.replace('-', '_'), 0.5);
    return new Personality(
        base.id(),
        base.name(),
        base.skinValue(),
        base.skinSignature(),
        base.skill(),
        traits.archetype(),
        base.leverOffsets(),
        base.kits(),
        base.roles(),
        base.style(),
        voice,
        LINES,
        traits.quirks(),
        traits.rivals(),
        base.bio(),
        base.batch(),
        base.retired());
  }

  static Personality plain(String id) {
    return bot(id, Archetype.FLANKER, Set.of(Quirk.SPINS), List.of());
  }

  static ChatScene.Member member(UUID uuid, String name, Personality bot, String team) {
    return new ChatScene.Member(uuid, name, Optional.of(bot), Optional.of(team), true);
  }

  static ChatScene.Member human(UUID uuid, String name, String team) {
    return new ChatScene.Member(uuid, name, Optional.empty(), Optional.of(team), true);
  }

  static ChatScene.Member dead(ChatScene.Member member) {
    return new ChatScene.Member(member.uuid(), member.name(), member.bot(), member.team(), false);
  }

  /** {@code base} with a one-second per-bot cooldown, to isolate other rules. */
  static ChatSettings quickCooldown(ChatSettings base) {
    return new ChatSettings(
        base.chances(),
        base.verbosity(),
        base.rivalBoost(),
        Duration.ofSeconds(1),
        base.window(),
        base.maxLinesPerWindow(),
        base.minGap(),
        base.reactionMin(),
        base.reactionMax(),
        base.maxDelay(),
        base.recentDeath(),
        base.tauntEvery());
  }

  static ChatDirector director(ChatSettings settings, long seed) {
    return new ChatDirector(settings, new SplittableRandom(seed), T0);
  }

  private static final ChatScene.Member KILLER = member(REDBOT, "Red_Bot", plain("red-bot"), RED);
  private static final ChatScene.Member KILLER2 = member(REDBOT2, "Red_Two", plain("red-two"), RED);
  private static final ChatScene.Member VICTIM_BOT =
      member(BLUEBOT, "Blue_Bot", plain("blue-bot"), BLUE);
  private static final ChatScene.Member ALICE_BLUE = human(ALICE, "Alice", BLUE);
  private static final ChatScene.Member BOB_BLUE = human(BOB, "Bob", BLUE);

  private static Set<String> filled(List<String> pool, String placeholder, String value) {
    var out = new HashSet<String>();
    for (var line : pool) {
      out.add(line.replace(placeholder, value));
    }
    return out;
  }

  @Test
  void aBotKillerBragsWithItsVictimsNameFilledIn() {
    var director = director(settings(1), 1);
    var scene = new ChatScene(List.of(KILLER, KILLER2, dead(ALICE_BLUE), BOB_BLUE));

    var lines = director.on(new ChatMoment.Died(ALICE, Optional.of(REDBOT)), scene, T0);

    assertThat(lines).hasSize(1);
    var line = lines.getFirst();
    assertThat(line.speaker()).isEqualTo(REDBOT);
    assertThat(line.name()).isEqualTo("Red_Bot");
    assertThat(line.team()).isEqualTo(RED);
    assertThat(line.moment()).isEqualTo(Moment.ON_KILL);
    assertThat(line.text()).isIn(filled(LINES.onKill(), "{victim}", "Alice"));
    assertThat(line.text()).doesNotContain("{");
    assertThat(line.at()).isEqualTo(T0);
  }

  @Test
  void aKilledBotNamesItsKillerAndADeathWithNoKillerSkipsThoseLines() {
    var scene = new ChatScene(List.of(dead(VICTIM_BOT), ALICE_BLUE, KILLER, KILLER2));
    var named =
        director(settings(1), 2).on(new ChatMoment.Died(BLUEBOT, Optional.of(ALICE)), scene, T0);
    assertThat(named)
        .singleElement()
        .satisfies(l -> assertThat(l.moment()).isEqualTo(Moment.ON_DEATH));
    assertThat(named.getFirst().text()).isIn(filled(LINES.onDeath(), "{killer}", "Alice"));

    for (var seed = 0; seed < 40; seed++) {
      var bombed =
          director(settings(1), seed).on(new ChatMoment.Died(BLUEBOT, Optional.empty()), scene, T0);
      assertThat(bombed).singleElement().satisfies(l -> assertThat(l.text()).isIn("ow", "lag"));
    }
  }

  @Test
  void aKillBetweenTwoBotsGetsOneLineAtMost() {
    var scene = new ChatScene(List.of(KILLER, KILLER2, dead(VICTIM_BOT), ALICE_BLUE));
    var speakers = new HashSet<UUID>();
    for (var seed = 0; seed < 50; seed++) {
      var lines =
          director(settings(1), seed)
              .on(new ChatMoment.Died(BLUEBOT, Optional.of(REDBOT)), scene, T0);
      assertThat(lines).hasSize(1);
      speakers.add(lines.getFirst().speaker());
    }
    assertThat(speakers)
        .as("either side may get the line")
        .containsExactlyInAnyOrder(REDBOT, BLUEBOT);
  }

  @Test
  void eachBotWaitsOutItsCooldown() {
    var director = director(settings(1), 3);
    var scene = new ChatScene(List.of(KILLER, dead(ALICE_BLUE), dead(BOB_BLUE)));

    assertThat(director.on(new ChatMoment.Died(ALICE, Optional.of(REDBOT)), scene, T0)).hasSize(1);
    assertThat(
            director.on(new ChatMoment.Died(BOB, Optional.of(REDBOT)), scene, T0.plusSeconds(19)))
        .as("inside the 20 s cooldown")
        .isEmpty();
    assertThat(
            director.on(new ChatMoment.Died(BOB, Optional.of(REDBOT)), scene, T0.plusSeconds(20)))
        .hasSize(1);
  }

  @Test
  void aBotNeverRepeatsALineWithinAMatch() {
    var director = director(settings(1), 4);
    var scene = new ChatScene(List.of(KILLER, dead(ALICE_BLUE)));
    var said = new ArrayList<String>();
    for (var i = 0; i < 5; i++) {
      for (var line :
          director.on(
              new ChatMoment.Died(ALICE, Optional.of(REDBOT)), scene, T0.plusSeconds(30L * i))) {
        said.add(line.template());
      }
    }
    assertThat(said).containsExactlyInAnyOrderElementsOf(LINES.onKill());
  }

  @Test
  void allBotsTogetherKeepTheGapAndTheWindowBudgetAndDropStaleLines() {
    var bots = new ArrayList<ChatScene.Member>();
    for (var i = 0; i < 6; i++) {
      bots.add(member(new UUID(1, i), "Bot_" + i, plain("bot-" + i), i % 2 == 0 ? RED : BLUE));
    }
    var director = director(settings(1), 5);

    var greets = director.on(new ChatMoment.Started(), new ChatScene(bots), T0);

    assertThat(greets).extracting(Utterance::moment).containsOnly(Moment.GREET);
    assertThat(greets)
        .extracting(Utterance::at)
        .containsExactly(T0, T0.plusSeconds(1), T0.plusSeconds(2), T0.plusSeconds(3));
    assertThat(greets).extracting(Utterance::speaker).doesNotHaveDuplicates();

    // Bots 4 and 5 were crowded out of the greeting. Bot 4's kill at T0 + 5 s waits for the
    // window to free at T0 + 10 s, just inside the 5 s maxDelay.
    var scene = new ChatScene(bots);
    var late =
        director.on(
            new ChatMoment.Died(new UUID(1, 1), Optional.of(new UUID(1, 4))),
            scene,
            T0.plusSeconds(5));
    assertThat(late)
        .singleElement()
        .satisfies(line -> assertThat(line.at()).isEqualTo(T0.plusSeconds(10)));
    var dropped =
        director.on(
            new ChatMoment.Died(new UUID(1, 0), Optional.of(new UUID(1, 5))),
            scene,
            T0.plusSeconds(5));
    assertThat(dropped).as("its slot at T0 + 11 s is past the 5 s maxDelay").isEmpty();
  }

  @Test
  void deadBotsSpeakOnlyForAWhileAfterDying() {
    var director = director(quickCooldown(settings(1)), 6);
    var carol = human(new UUID(0, 3), "Carol", BLUE);
    var scene = new ChatScene(List.of(dead(KILLER), KILLER2, ALICE_BLUE, BOB_BLUE, carol));
    director.on(new ChatMoment.Died(REDBOT, Optional.of(BOB)), scene, T0);

    var early =
        director.on(new ChatMoment.Died(ALICE, Optional.of(REDBOT)), scene, T0.plusSeconds(5));
    assertThat(early)
        .as("its arrow landed 5 s after it died, inside recentDeath")
        .singleElement()
        .satisfies(line -> assertThat(line.speaker()).isEqualTo(REDBOT));
    var late = director.on(new ChatMoment.Died(BOB, Optional.of(REDBOT)), scene, T0.plusSeconds(9));
    assertThat(late).as("9 s after it died, past recentDeath").isEmpty();

    var stranger = director(settings(1), 7);
    assertThat(stranger.on(new ChatMoment.Died(ALICE, Optional.of(REDBOT)), scene, T0))
        .as("a bot this director never saw die is dead and silent")
        .noneMatch(line -> line.speaker().equals(REDBOT));
  }

  @Test
  void theLastBotStandingOnATeamSpeaksOnce() {
    var director = director(settings(1), 9);
    var start = new ChatScene(List.of(KILLER, KILLER2, ALICE_BLUE, BOB_BLUE));
    director.on(new ChatMoment.Started(), start, T0);

    var after = new ChatScene(List.of(dead(KILLER), KILLER2, ALICE_BLUE, BOB_BLUE));
    var lines =
        director.on(new ChatMoment.Died(REDBOT, Optional.of(ALICE)), after, T0.plusSeconds(30));

    assertThat(lines)
        .filteredOn(line -> line.moment() == Moment.ON_LAST_ALIVE)
        .singleElement()
        .satisfies(line -> assertThat(line.speaker()).isEqualTo(REDBOT2));
    assertThat(director.on(new ChatMoment.Idle(), after, T0.plusSeconds(31)))
        .filteredOn(line -> line.moment() == Moment.ON_LAST_ALIVE)
        .isEmpty();
  }

  @Test
  void aTeamOfOneAtTheStartIsNotALastStand() {
    var director = director(settings(1), 10);
    var lines =
        director.on(new ChatMoment.Started(), new ChatScene(List.of(KILLER, ALICE_BLUE)), T0);
    assertThat(lines).extracting(Utterance::moment).containsOnly(Moment.GREET);
  }

  @Test
  void idleTauntsComeFromLivingBotsWhenDue() {
    var director = director(settings(1), 11);
    var scene = new ChatScene(List.of(KILLER, KILLER2, dead(VICTIM_BOT), ALICE_BLUE));
    assertThat(director.on(new ChatMoment.Idle(), scene, T0.plusSeconds(14)))
        .as("the first taunt waits at least half of tauntEvery")
        .isEmpty();

    var taunts = director.on(new ChatMoment.Idle(), scene, T0.plusSeconds(45));

    assertThat(taunts)
        .singleElement()
        .satisfies(
            line -> {
              assertThat(line.speaker()).as("only living bots taunt").isIn(REDBOT, REDBOT2);
              assertThat(line.moment()).isEqualTo(Moment.TAUNT);
              assertThat(line.template()).isIn(LINES.taunt());
            });
    assertThat(director.on(new ChatMoment.Idle(), scene, T0.plusSeconds(46))).isEmpty();
  }

  @Test
  void winnersAndLosersSayTheirLinesAndADrawIsQuiet() {
    var scene = new ChatScene(List.of(KILLER, dead(VICTIM_BOT), ALICE_BLUE));
    var lines = director(settings(1), 12).on(new ChatMoment.Ended(Optional.of(RED)), scene, T0);

    assertThat(lines)
        .anySatisfy(
            line -> {
              assertThat(line.speaker()).isEqualTo(REDBOT);
              assertThat(line.moment()).isEqualTo(Moment.ON_WIN);
              assertThat(line.text()).isIn("gg Red Team", "we did it");
            })
        .anySatisfy(
            line -> {
              assertThat(line.speaker()).as("dead bots still say gg").isEqualTo(BLUEBOT);
              assertThat(line.moment()).isEqualTo(Moment.ON_LOSS);
            });
    assertThat(director(settings(1), 12).on(new ChatMoment.Ended(Optional.empty()), scene, T0))
        .isEmpty();
  }

  @Test
  void nothingIsSaidAfterTheMatchEnds() {
    var director = director(settings(1), 13);
    var scene = new ChatScene(List.of(KILLER, dead(ALICE_BLUE)));
    director.on(new ChatMoment.Ended(Optional.empty()), scene, T0);

    assertThat(director.on(new ChatMoment.Died(ALICE, Optional.of(REDBOT)), scene, T0)).isEmpty();
    assertThat(director.on(new ChatMoment.Idle(), scene, T0.plusSeconds(120))).isEmpty();
    assertThat(director.on(new ChatMoment.Started(), scene, T0)).isEmpty();
  }

  @Test
  void alwaysGgSaysAGgLineWhateverTheChance() {
    var gg =
        member(
            REDBOT2,
            "Gg_Bot",
            bot("gg-bot", Archetype.SUPPORT, Set.of(Quirk.ALWAYS_GG), List.of()),
            BLUE);
    var scene = new ChatScene(List.of(KILLER, gg));
    for (var seed = 0; seed < 30; seed++) {
      var lines = director(settings(0), seed).on(new ChatMoment.Ended(Optional.of(RED)), scene, T0);
      assertThat(lines)
          .as("only the always_gg bot speaks at chance 0")
          .singleElement()
          .satisfies(
              line -> {
                assertThat(line.speaker()).isEqualTo(REDBOT2);
                assertThat(line.moment()).isEqualTo(Moment.ON_LOSS);
                assertThat(line.text()).isEqualTo("gg wp");
              });
    }
  }

  @Test
  void chancesFollowArchetypeVerbosityToneQuirksAndRivals() {
    var settings = settings(0.2);
    var troll = bot("troll", Archetype.TROLL, Set.of(Quirk.SPINS), List.of());
    var tactician = bot("tactician", Archetype.TACTICIAN, Set.of(Quirk.SPINS), List.of());
    var flanker = plain("flanker");
    var plainContext = Chattiness.Context.PLAIN;

    assertThat(Chattiness.chance(settings, troll, Moment.TAUNT, plainContext))
        .isGreaterThan(Chattiness.chance(settings, flanker, Moment.TAUNT, plainContext));
    assertThat(Chattiness.chance(settings, tactician, Moment.TAUNT, plainContext))
        .isLessThan(Chattiness.chance(settings, flanker, Moment.TAUNT, plainContext));
    assertThat(Chattiness.chance(settings, flanker, Moment.TAUNT, plainContext))
        .isCloseTo(0.2, CLOSE);
    assertThat(
            Chattiness.chance(
                settings, flanker, Moment.ON_KILL, new Chattiness.Context(true, false)))
        .as("aimed at a rival")
        .isCloseTo(0.4, CLOSE);

    var loud = toned("loud", "hype");
    var quiet = toned("quiet", "terse");
    assertThat(Chattiness.chance(settings, loud, Moment.GREET, plainContext))
        .isCloseTo(0.25, CLOSE);
    assertThat(Chattiness.chance(settings, quiet, Moment.GREET, plainContext))
        .isCloseTo(0.15, CLOSE);

    var lagger = bot("lagger", Archetype.FLANKER, Set.of(Quirk.BLAMES_LAG), List.of());
    assertThat(Chattiness.chance(settings, lagger, Moment.ON_DEATH, plainContext))
        .isCloseTo(0.4, CLOSE);
    var nuker = bot("nuker", Archetype.FLANKER, Set.of(Quirk.LOVES_NUKE), List.of());
    assertThat(
            Chattiness.chance(
                settings, nuker, Moment.ON_PLANT, new Chattiness.Context(false, true)))
        .isCloseTo(0.4, CLOSE);
    assertThat(Chattiness.chance(settings, nuker, Moment.ON_PLANT, plainContext))
        .isCloseTo(0.2, CLOSE);

    var chatty =
        new ChatSettings(
            settings.chances(),
            Map.of(
                Voice.Verbosity.QUIET,
                0.5,
                Voice.Verbosity.NORMAL,
                3.0,
                Voice.Verbosity.CHATTY,
                4.0),
            2,
            settings.botCooldown(),
            settings.window(),
            settings.maxLinesPerWindow(),
            settings.minGap(),
            settings.reactionMin(),
            settings.reactionMax(),
            settings.maxDelay(),
            settings.recentDeath(),
            settings.tauntEvery());
    assertThat(Chattiness.chance(chatty, flanker, Moment.ON_KILL, plainContext))
        .isCloseTo(0.6, CLOSE);
    assertThat(Chattiness.chance(chatty, troll, Moment.TAUNT, plainContext)).isEqualTo(1);
  }

  @Test
  void trollsTauntFarMoreThanTacticiansOverManyMatches() {
    var troll =
        member(REDBOT, "Troll", bot("troll", Archetype.TROLL, Set.of(Quirk.SPINS), List.of()), RED);
    var tactician =
        member(
            REDBOT2,
            "Tactician",
            bot("tactician", Archetype.TACTICIAN, Set.of(Quirk.SPINS), List.of()),
            RED);
    var trolls = 0;
    var tacticians = 0;
    for (var seed = 0; seed < 400; seed++) {
      var scene = new ChatScene(List.of(troll, tactician, ALICE_BLUE));
      for (var line :
          director(settings(0.2), seed).on(new ChatMoment.Idle(), scene, T0.plusSeconds(60))) {
        if (line.speaker().equals(REDBOT)) {
          trolls++;
        } else {
          tacticians++;
        }
      }
    }
    assertThat(trolls).isGreaterThan(5 * tacticians);
  }

  @Test
  void rivalsAndGrudgesAreTauntedMoreOften() {
    var rival = bot("rival", Archetype.FLANKER, Set.of(Quirk.SPINS), List.of("blue-bot"));
    var grudger = bot("grudger", Archetype.FLANKER, Set.of(Quirk.HOLDS_GRUDGES), List.of());
    var plain = 0;
    var aimed = 0;
    var grudge = 0;
    for (var seed = 0; seed < 400; seed++) {
      plain += revengeLines(plain("stranger"), seed);
      aimed += revengeLines(rival, seed);
      grudge += revengeLines(grudger, seed);
    }
    assertThat(aimed).isGreaterThan(plain * 3 / 2);
    assertThat(grudge).isGreaterThan(plain * 3 / 2);
  }

  /**
   * Blue_Bot kills {@code killer}, whose arrow kills Blue_Bot three seconds later: 1 if {@code
   * killer} bragged about it, else 0.
   */
  private static int revengeLines(Personality killer, long seed) {
    var director = director(quickCooldown(settings(0.3)), seed);
    var red = member(REDBOT, "Red_Bot", killer, RED);
    director.on(
        new ChatMoment.Died(REDBOT, Optional.of(BLUEBOT)),
        new ChatScene(List.of(dead(red), KILLER2, VICTIM_BOT, ALICE_BLUE)),
        T0);
    var lines =
        director.on(
            new ChatMoment.Died(BLUEBOT, Optional.of(REDBOT)),
            new ChatScene(List.of(dead(red), KILLER2, dead(VICTIM_BOT), ALICE_BLUE)),
            T0.plusSeconds(3));
    return lines.stream().anyMatch(line -> line.moment() == Moment.ON_KILL) ? 1 : 0;
  }

  @Test
  void theSameSeedReplaysTheSameChat() {
    var bots = new ArrayList<ChatScene.Member>();
    for (var i = 0; i < 6; i++) {
      bots.add(member(new UUID(2, i), "Bot_" + i, plain("bot-" + i), i % 2 == 0 ? RED : BLUE));
    }
    var scene = new ChatScene(bots);
    var first = play(director(settings(0.5), 42), scene);
    var again = play(director(settings(0.5), 42), scene);
    assertThat(again).isEqualTo(first);
    var differs = false;
    for (var seed = 0; seed < 20 && !differs; seed++) {
      differs = !play(director(settings(0.5), seed), scene).equals(first);
    }
    assertThat(differs).isTrue();
  }

  private static List<Utterance> play(ChatDirector director, ChatScene scene) {
    var out = new ArrayList<Utterance>();
    out.addAll(director.on(new ChatMoment.Started(), scene, T0));
    for (var i = 0; i < 6; i++) {
      var victim = scene.members().get(i).uuid();
      var killer = scene.members().get((i + 1) % 6).uuid();
      out.addAll(
          director.on(
              new ChatMoment.Died(victim, Optional.of(killer)), scene, T0.plusSeconds(15L * i)));
      out.addAll(director.on(new ChatMoment.Idle(), scene, T0.plusSeconds(15L * i + 7)));
    }
    return out;
  }

  @Test
  void plantAndDefuseLinesNameTheBomb() {
    var director = director(settings(1), 14);
    var scene = new ChatScene(List.of(KILLER, KILLER2, ALICE_BLUE));
    var planted = director.on(new ChatMoment.Planted(REDBOT, "Blue Team's bomb", false), scene, T0);
    assertThat(planted)
        .singleElement()
        .satisfies(line -> assertThat(line.text()).isIn("Blue Team's bomb is lit", "boom soon"));
    var defused =
        director.on(new ChatMoment.Defused(REDBOT, "Red Team's bomb"), scene, T0.plusSeconds(30));
    assertThat(defused)
        .singleElement()
        .satisfies(line -> assertThat(line.text()).isIn("Red Team's bomb is safe", "not today"));
    assertThat(
            director.on(
                new ChatMoment.Planted(ALICE, "Red Team's bomb", false), scene, T0.plusSeconds(60)))
        .as("humans have no lines")
        .isEmpty();
  }

  @Test
  void aMomentNamingSomeoneOutsideTheMatchIsABrokenContract() {
    var director = director(settings(1), 15);
    assertThatThrownBy(
            () ->
                director.on(
                    new ChatMoment.Died(ALICE, Optional.empty()),
                    new ChatScene(List.of(KILLER)),
                    T0))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("not in the match");
  }

  @Test
  void everyArchetypeHasALeaningForEveryMoment() {
    for (var archetype : Archetype.values()) {
      for (var moment : Moment.values()) {
        assertThat(Chattiness.archetype(archetype, moment)).isPositive();
      }
    }
  }

  @Test
  void settingsRefuseOutOfRangeValues() {
    var good = settings(0.5);
    var chances = new EnumMap<>(good.chances());
    chances.put(Moment.TAUNT, 1.5);
    assertThatThrownBy(
            () ->
                new ChatSettings(
                    chances,
                    good.verbosity(),
                    good.rivalBoost(),
                    good.botCooldown(),
                    good.window(),
                    good.maxLinesPerWindow(),
                    good.minGap(),
                    good.reactionMin(),
                    good.reactionMax(),
                    good.maxDelay(),
                    good.recentDeath(),
                    good.tauntEvery()))
        .hasMessageContaining("taunt");
    assertThatThrownBy(
            () ->
                new ChatSettings(
                    good.chances(),
                    good.verbosity(),
                    good.rivalBoost(),
                    good.botCooldown(),
                    good.window(),
                    good.maxLinesPerWindow(),
                    good.minGap(),
                    Duration.ofSeconds(2),
                    Duration.ofSeconds(1),
                    good.maxDelay(),
                    good.recentDeath(),
                    good.tauntEvery()))
        .hasMessageContaining("reaction");
    assertThatThrownBy(
            () ->
                new ChatSettings(
                    good.chances(),
                    good.verbosity(),
                    5,
                    good.botCooldown(),
                    good.window(),
                    good.maxLinesPerWindow(),
                    good.minGap(),
                    good.reactionMin(),
                    good.reactionMax(),
                    good.maxDelay(),
                    good.recentDeath(),
                    good.tauntEvery()))
        .hasMessageContaining("rivalBoost");
  }
}
