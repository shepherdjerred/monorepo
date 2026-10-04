package com.shepherdjerred.thestorm.npcs.domain.combat;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;

final class WarningDeckTest {
  @Test
  void usesTheWholeBankBeforeRepeatingAndNeverRepeatsAcrossAShuffle() {
    var phrases = List.of("Hands off!", "Stop that.", "Keep the peace.");
    var deck = new WarningDeck(phrases, new Random(73));
    var previous = "";
    for (var cycle = 0; cycle < 20; cycle++) {
      var drawn = new ArrayList<String>();
      for (var index = 0; index < phrases.size(); index++) {
        var phrase = deck.next();
        assertThat(phrase).isNotEqualTo(previous);
        drawn.add(phrase);
        previous = phrase;
      }
      assertThat(drawn).containsExactlyInAnyOrderElementsOf(phrases);
    }
  }
}
