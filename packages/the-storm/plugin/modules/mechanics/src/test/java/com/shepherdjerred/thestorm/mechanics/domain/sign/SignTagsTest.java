package com.shepherdjerred.thestorm.mechanics.domain.sign;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;

final class SignTagsTest {

  @ParameterizedTest
  @EnumSource(Mechanism.class)
  void everyCanonicalTagNamesItsMechanism(Mechanism mechanism) {
    assertThat(SignTags.parse(mechanism.tag())).contains(mechanism);
  }

  @ParameterizedTest
  @ValueSource(strings = {"[lift up]", "[LIFT UP]", "[LiftUp]", "  [ lift   up ]  ", "[Lift\tUp]"})
  void matchingIgnoresCaseAndWhitespace(String line) {
    assertThat(SignTags.parse(line)).contains(Mechanism.LIFT_UP);
  }

  @Test
  void superPistonsMatchWithOrWithoutASpace() {
    assertThat(SignTags.parse("[Super Sticky]")).contains(Mechanism.SUPER_STICKY);
    assertThat(SignTags.parse("[superpush]")).contains(Mechanism.SUPER_PUSH);
  }

  @Test
  void theCraftBookLightSwitchSpellingIsAccepted() {
    assertThat(SignTags.parse("[I]")).contains(Mechanism.LIGHT_SWITCH);
    assertThat(SignTags.parse("[i]")).contains(Mechanism.LIGHT_SWITCH);
    assertThat(SignTags.parse("[|]")).contains(Mechanism.LIGHT_SWITCH);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "",
        "Lift Up",
        "[Lift Up",
        "Lift Up]",
        "[Lift Sideways]",
        "[Bridge End]",
        "[Door]",
        "[]",
        "[[X]]",
        "hello"
      })
  void otherTextIsNotAMechanism(String line) {
    assertThat(SignTags.parse(line)).isEmpty();
  }

  @Test
  void featuresGroupTheirSigns() {
    assertThat(Mechanism.LIFT.isLift()).isTrue();
    assertThat(Mechanism.LIFT_UP.feature()).isEqualTo(Feature.ELEVATOR);
    assertThat(Mechanism.CRUSH.isPiston()).isTrue();
    assertThat(Mechanism.BRIDGE.isPiston()).isFalse();
    assertThat(Mechanism.GATE.isStructure()).isTrue();
    assertThat(Mechanism.DOOR_DOWN.isStructure()).isTrue();
    assertThat(Mechanism.LIFT.isStructure()).isFalse();
  }
}
