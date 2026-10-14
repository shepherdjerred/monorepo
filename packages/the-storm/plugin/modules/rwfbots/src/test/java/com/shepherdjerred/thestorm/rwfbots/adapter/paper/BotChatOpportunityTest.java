package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class BotChatOpportunityTest {
  @Test
  void onlyUnoccupiedStationaryHoldsOfferTimeForCasualSpeech() {
    for (var option : Option.values()) {
      assertThat(BotChat.idleOpportunity(decision(option, List.of(), false, false)))
          .as("%s without a path", option)
          .isEqualTo(option == Option.HOLD_SLOT || option == Option.HOLD_ANGLE);
    }
    for (var option : List.of(Option.HOLD_SLOT, Option.HOLD_ANGLE)) {
      assertThat(
              BotChat.idleOpportunity(
                  decision(
                      option,
                      List.of(new Waypoint(new Vec3(3.5, 1, 1.5), Hop.WALK)),
                      false,
                      false)))
          .as("holding still requires arriving, even for %s", option)
          .isFalse();
      assertThat(BotChat.idleOpportunity(decision(option, List.of(), true, false)))
          .as("aiming at an opponent is occupied")
          .isFalse();
      assertThat(BotChat.idleOpportunity(decision(option, List.of(), false, true)))
          .as("an ability owns this frame")
          .isFalse();
    }
  }

  private static Decision decision(
      Option option, List<Waypoint> path, boolean target, boolean ability) {
    return new Decision(
        new CombatantId(1),
        option,
        target ? Optional.of(new CombatantId(2)) : Optional.empty(),
        path,
        Stance.CAUTIOUS,
        Optional.empty(),
        Optional.empty(),
        ability ? Optional.of("rewind") : Optional.empty(),
        "speech-opportunity",
        10,
        0,
        Optional.empty());
  }
}
