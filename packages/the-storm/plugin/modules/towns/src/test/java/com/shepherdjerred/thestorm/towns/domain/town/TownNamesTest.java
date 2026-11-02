package com.shepherdjerred.thestorm.towns.domain.town;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Camp names taken from account names, and the generated names they replace. */
final class TownNamesTest {

  @Test
  void aCampUsesTheAccountName() {
    assertThat(TownNames.friendly("Lincbuggy", name -> false)).contains("Lincbuggy");
  }

  @Test
  void aTakenNameGainsASuffix() {
    var reserved = new HashSet<String>();
    reserved.add("lincbuggy");

    assertThat(TownNames.friendly("Lincbuggy", candidate -> taken(reserved, candidate)))
        .contains("Lincbuggy2");
  }

  @Test
  void aShortOrDirtyNameIsPaddedAndStripped() {
    assertThat(TownNames.friendly("A", name -> false)).contains("A_c");
    assertThat(TownNames.friendly(".Bo", name -> false)).contains("Bo_c");
    assertThat(TownNames.friendly("...", name -> false)).isEmpty();
  }

  @Test
  void aGeneratedHexNameIsRecognizedAndNotReused() {
    var generated = TownNames.campName(UUID.randomUUID());

    assertThat(TownNames.isGenerated(generated)).isTrue();
    assertThat(TownNames.isGenerated("Lincbuggy")).isFalse();
    assertThat(TownNames.isPublic(generated)).isFalse();
    assertThat(TownNames.isGenerated(TownNames.friendly(generated, name -> false).orElseThrow()))
        .isFalse();
  }

  private static boolean taken(Set<String> names, String candidate) {
    return names.contains(candidate.toLowerCase(Locale.ROOT));
  }
}
