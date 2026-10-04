package com.shepherdjerred.thestorm.rwfbots.domain.personality;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.lines;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.personality;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.withWeights;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class PersonalityTest {

  @Test
  void acceptsAWellFormedPersonality() {
    var p = personality("ash", "Ash_42", 0.6);
    assertThat(p.name()).isEqualTo("Ash_42");
    assertThat(p.kits()).containsKey(Kit.TROOPER);
  }

  @Test
  void rejectsBadNames() {
    for (var name : List.of("ab", ".dotty", "has space", "too_long_name_here_", "näme")) {
      assertThatThrownBy(() -> personality("tester", name, 0.5))
          .as(name)
          .isInstanceOf(IllegalArgumentException.class);
    }
  }

  @Test
  void rejectsBadIdsSkillWeightsAndBatch() {
    assertThatThrownBy(() -> personality("Bad Id", "Fine", 0.5))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> personality("ok", "Fine", 1.5))
        .isInstanceOf(IllegalArgumentException.class);
    var base = personality("ok", "Fine", 0.5);
    assertThatThrownBy(() -> withKits(base, Map.of(Kit.TROOPER, 0.0)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> withKits(base, Map.of())).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rejectsUnknownLeverFields() {
    assertThatThrownBy(() -> LeverOffsets.parse(Map.of("charisma", 1.0)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("charisma");
  }

  @Test
  void aVoiceNeedsOneToFourDistinctTagsAndAStyleNote() {
    var normal = Voice.Verbosity.NORMAL;
    assertThat(new Voice(List.of("dry", "hype"), normal, "terse callouts").toneTags())
        .containsExactly("dry", "hype");
    assertThatThrownBy(() -> new Voice(List.of(), normal, "x"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Voice(List.of("a1", "b1", "c1", "d1", "e1"), normal, "x"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Voice(List.of("dry", "dry"), normal, "x"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Voice(List.of("Loud!"), normal, "x"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Voice(List.of("dry"), normal, " "))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Voice(List.of("dry"), normal, "x".repeat(121)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void everyPoolHoldsTwoToSixShortLines() {
    var two = List.of("ok", "sure");
    assertThat(lines().pool(Lines.Moment.TAUNT)).containsExactly("ok", "sure");
    assertThatThrownBy(() -> new Lines(List.of("ok"), two, two, two, two, two, two, two, two))
        .hasMessageContaining("greet needs 2..6 lines");
    var seven = List.of("a", "b", "c", "d", "e", "f", "g");
    assertThatThrownBy(() -> new Lines(two, two, two, two, two, two, two, two, seven))
        .hasMessageContaining("taunt needs 2..6 lines");
    var long81 = List.of("ok", "x".repeat(81));
    assertThatThrownBy(() -> new Lines(two, long81, two, two, two, two, two, two, two))
        .hasMessageContaining("onKill lines must be 1..80");
    var repeated = List.of("gg", "gg");
    assertThatThrownBy(() -> new Lines(two, two, two, two, two, repeated, two, two, two))
        .hasMessageContaining("onWin repeats a line");
  }

  @Test
  void eachMomentAllowsOnlyItsOwnPlaceholders() {
    var two = List.of("ok", "sure");
    var kill = List.of("sit down, {victim}", "one for {team}");
    var death = List.of("nice shot {killer}", "ugh");
    var plant = List.of("{bomb} is lit", "go {team}");
    var lines = new Lines(two, kill, death, plant, plant, two, two, two, two);
    assertThat(lines.onKill()).contains("sit down, {victim}");
    assertThat(Lines.placeholdersOf("{victim} vs {team}"))
        .containsExactlyInAnyOrder(Lines.Placeholder.VICTIM, Lines.Placeholder.TEAM);

    assertThatThrownBy(
            () -> new Lines(List.of("hi {victim}", "yo"), two, two, two, two, two, two, two, two))
        .hasMessageContaining("greet lines may not use {victim}");
    assertThatThrownBy(
            () -> new Lines(two, two, two, two, two, two, two, two, List.of("{me}", "x")))
        .hasMessageContaining("unknown placeholder {me}");
    assertThatThrownBy(() -> new Lines(two, two, two, two, two, two, two, two, List.of("a {", "x")))
        .hasMessageContaining("stray brace");
  }

  @Test
  void quirksAndRivalsAreBounded() {
    var base = personality("ok", "Fine", 0.5);
    assertThat(base.quirks()).containsExactly(Quirk.ALWAYS_GG);
    assertThatThrownBy(() -> with(base, Set.of(), List.of()))
        .hasMessageContaining("needs 1..3 quirks");
    var four = Set.of(Quirk.ALWAYS_GG, Quirk.SPINS, Quirk.NARRATES, Quirk.BLAMES_LAG);
    assertThatThrownBy(() -> with(base, four, List.of())).hasMessageContaining("1..3 quirks");
    var gg = Set.of(Quirk.ALWAYS_GG);
    assertThatThrownBy(() -> with(base, gg, List.of("ok"))).hasMessageContaining("bad rival");
    assertThatThrownBy(() -> with(base, gg, List.of("a1", "a1")))
        .hasMessageContaining("distinct rivals");
    assertThatThrownBy(() -> with(base, gg, List.of("a1", "b1", "c1", "d1")))
        .hasMessageContaining("at most three");
  }

  @Test
  void aBioIsOneToThreeHundredCharacters() {
    var base = personality("ok", "Fine", 0.5);
    assertThatThrownBy(() -> withBio(base, "")).hasMessageContaining("bio must be 1..300");
    assertThatThrownBy(() -> withBio(base, "x".repeat(301))).hasMessageContaining("1..300");
    assertThat(withBio(base, "x".repeat(300)).bio()).hasSize(300);
  }

  @Test
  void catalogRivalsMustExist() {
    var a = with(personality("ashen", "Ashen", 0.5), Set.of(Quirk.SPINS), List.of("birch"));
    var b = personality("birch", "Birch", 0.5);
    assertThat(new PersonalityCatalog(List.of(a, b)).byId("ashen").orElseThrow().rivals())
        .containsExactly("birch");
    assertThatThrownBy(() -> new PersonalityCatalog(List.of(a)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("ashen names an unknown rival: birch");
  }

  @Test
  void catalogRejectsDuplicateOrNearIdenticalNames() {
    var a = personality("ashen", "Ashen", 0.5);
    var b = personality("ashes", "Ashes", 0.5);
    var c = personality("ashen-2", "ashen", 0.5);
    var d = personality("birch", "Birch", 0.5);
    assertThatThrownBy(() -> new PersonalityCatalog(List.of(a, b)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("too similar");
    assertThatThrownBy(() -> new PersonalityCatalog(List.of(a, c)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("duplicate");
    var catalog = new PersonalityCatalog(List.of(a, d));
    assertThat(catalog.active()).hasSize(2);
    assertThat(EditDistance.levenshtein("kitten", "sitting")).isEqualTo(3);
  }

  private static Personality withKits(Personality base, Map<Kit, Double> kits) {
    return withWeights(base, kits, Map.of(Role.PLANT, 1.0));
  }

  private static Personality with(Personality base, Set<Quirk> quirks, List<String> rivals) {
    return copy(base, quirks, rivals, base.bio());
  }

  private static Personality withBio(Personality base, String bio) {
    return copy(base, base.quirks(), base.rivals(), bio);
  }

  private static Personality copy(
      Personality base, Set<Quirk> quirks, List<String> rivals, String bio) {
    return new Personality(
        base.id(),
        base.name(),
        base.skinValue(),
        base.skinSignature(),
        base.skill(),
        base.archetype(),
        base.leverOffsets(),
        base.kits(),
        base.roles(),
        base.style(),
        base.voice(),
        base.lines(),
        quirks,
        rivals,
        bio,
        base.batch(),
        base.retired());
  }
}
