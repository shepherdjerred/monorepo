package com.shepherdjerred.thestorm.rwf.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class MatchExperiencesTest {
  @Test
  void overridesWaitForTheNextDraftAndLateArrivalsKeepTheirOriginalSettings() {
    var owner = new MatchExperiences(ExperienceSettings.DEFAULT);
    var first = UUID.fromString("00000000-0000-0000-0000-000000000001");
    var second = UUID.fromString("00000000-0000-0000-0000-000000000002");
    var frozen = owner.freeze(first, 31);
    owner.select(ExperienceSettings.Preset.RELAXED.settings());
    assertThat(owner.freeze(first, 31)).isSameAs(frozen);
    assertThat(frozen.settings().difficulty()).isEqualTo(ExperienceSettings.Difficulty.HARD);
    assertThat(owner.freeze(second, 32).settings().difficulty())
        .isEqualTo(ExperienceSettings.Difficulty.EASY);
    assertThat(new MatchExperiences(ExperienceSettings.DEFAULT).pending())
        .isEqualTo(ExperienceSettings.DEFAULT);
  }

  @Test
  void onlyTheExplicitEmptyShowcasePathMayRebindAnExistingSeed() {
    var owner = new MatchExperiences(ExperienceSettings.DEFAULT);
    var id = UUID.fromString("00000000-0000-0000-0000-000000000001");
    owner.freeze(id, 31);
    assertThatThrownBy(() -> owner.freeze(id, 32)).isInstanceOf(IllegalStateException.class);
    owner.select(ExperienceSettings.Preset.RELAXED.settings());
    owner.reseedEmptyLobby(id, 32);
    assertThat(owner.freeze(id, 32).settings()).isEqualTo(ExperienceSettings.DEFAULT);
  }

  @Test
  void fingerprintsBindAllSettingsAndTheSeedWithCanonicalPoolOrder() {
    var first =
        ExperienceSettings.DEFAULT
            .withMaps(new LinkedHashSet<>(List.of("apex-expanse", "training-yard")))
            .withKits(Set.of("trooper", "longbow"));
    var reordered =
        ExperienceSettings.DEFAULT
            .withMaps(new LinkedHashSet<>(List.of("training-yard", "apex-expanse")))
            .withKits(Set.of("longbow", "trooper"));
    assertThat(first.fingerprint(31)).isEqualTo(reordered.fingerprint(31));
    assertThat(first.fingerprint(31)).isNotEqualTo(first.fingerprint(32));
    assertThat(first.fingerprint(31))
        .isNotEqualTo(first.withStyle(ExperienceSettings.Style.PUSH).fingerprint(31));
    assertThat(first.canonical(31))
        .contains("maps=apex-expanse,training-yard;kits=longbow,trooper");
    assertThatThrownBy(() -> first.withMaps(Set.of("../world")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
