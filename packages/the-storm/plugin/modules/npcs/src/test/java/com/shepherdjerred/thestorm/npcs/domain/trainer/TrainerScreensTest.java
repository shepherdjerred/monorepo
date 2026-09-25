package com.shepherdjerred.thestorm.npcs.domain.trainer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen.Button;
import com.shepherdjerred.thestorm.npcs.domain.dialogue.Screen.Choice;
import com.shepherdjerred.thestorm.npcs.domain.trainer.TrainerScreens.Quote;
import com.shepherdjerred.thestorm.npcs.domain.trainer.TrainerScreens.Standing;
import java.util.List;
import org.junit.jupiter.api.Test;

final class TrainerScreensTest {

  private static final Standing STANDING = new Standing("Mechanic", 2, 5);
  private static final Offer OFFER = new Offer("mechanic", 3, 5000);

  @Test
  void anOfferShowsLevelPriceAndBuy() {
    var screen =
        TrainerScreens.offer("Darren", STANDING, new Quote.Quoted(OFFER, "5,000 crystals"), "");
    assertThat(screen.title()).isEqualTo("Darren");
    assertThat(screen.body()).isEqualTo("Mechanic: level 2 of 5.\nLevel 3 costs 5,000 crystals.");
    assertThat(screen.buttons())
        .containsExactly(
            new Button("Buy level 3", new Choice.Buy(OFFER)),
            new Button("Close", new Choice.Close()));
  }

  @Test
  void aRefusalExplainsWithoutABuyButton() {
    var screen =
        TrainerScreens.offer(
            "Darren",
            STANDING,
            new Quote.Refused(List.of("Too poor.", "Too soon.")),
            "You are now level 2 in Mechanic.");
    assertThat(screen.body())
        .isEqualTo(
            "You are now level 2 in Mechanic.\nMechanic: level 2 of 5.\nToo poor.\nToo soon.");
    assertThat(screen.buttons()).containsExactly(new Button("Close", new Choice.Close()));
  }

  @Test
  void theConfirmationBuysOrGoesBack() {
    var screen = TrainerScreens.confirm("Darren", "Mechanic", OFFER, "5,000 crystals");
    assertThat(screen.body()).isEqualTo("Buy Mechanic level 3 for 5,000 crystals?");
    assertThat(screen.buttons())
        .containsExactly(
            new Button("Confirm", new Choice.Confirm(OFFER)),
            new Button("Back", new Choice.OpenTrainer()));
  }

  @Test
  void offersAndRefusalsValidate() {
    assertThatThrownBy(() -> new Offer("mechanic", 0, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Offer("mechanic", 1, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Quote.Refused(List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
