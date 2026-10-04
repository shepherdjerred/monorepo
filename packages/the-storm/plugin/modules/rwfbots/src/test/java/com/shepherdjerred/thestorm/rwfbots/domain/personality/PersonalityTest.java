package com.shepherdjerred.thestorm.rwfbots.domain.personality;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.personality;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.List;
import java.util.Map;
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
  void rejectsUnknownLeverFieldsAndTooManyCatchphrases() {
    assertThatThrownBy(() -> LeverOffsets.parse(Map.of("charisma", 1.0)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("charisma");
    assertThatThrownBy(
            () ->
                new Chat(
                    List.of("dry"), Chat.Verbosity.CHATTY, List.of("a", "b", "c", "d", "e", "f")))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Chat(List.of("Loud!"), Chat.Verbosity.CHATTY, List.of()))
        .isInstanceOf(IllegalArgumentException.class);
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
    return new Personality(
        base.id(),
        base.name(),
        base.skinValue(),
        base.skinSignature(),
        base.skill(),
        base.leverOffsets(),
        kits,
        Map.of(Role.PLANT, 1.0),
        base.style(),
        base.chat(),
        base.bio(),
        base.batch(),
        base.retired());
  }
}
