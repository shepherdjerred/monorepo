package com.shepherdjerred.thestorm.npcs.domain.brain;

import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.npc;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.spot;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.npcs.domain.brain.NpcBrain.Situation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Activity;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Schedule;
import com.shepherdjerred.thestorm.npcs.domain.schedule.TimeOfDay;
import com.shepherdjerred.thestorm.npcs.domain.schedule.TimeRange;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class NpcBrainTest {

  private static final Spot MARKET = spot(10, 64, 10);
  private static final Spot BED = spot(-5, 64, -5, 180);
  private static final Spot GATE = spot(20, 64, 0);
  private static final Spot INN = spot(0, 64, 30, 45);
  private static final Map<String, Spot> PLACES =
      Map.of("market", MARKET, "bed", BED, "gate", GATE, "inn", INN);

  private static Schedule.Slot slot(int from, int to, Activity activity) {
    return new Schedule.Slot(new TimeRange(TimeOfDay.of(from, 0), TimeOfDay.of(to, 0)), activity);
  }

  private static final Schedule DAY =
      new Schedule(
          "day",
          List.of(
              slot(6, 12, new Activity.Stay("home")),
              slot(12, 16, new Activity.Wander("market", 4)),
              slot(16, 20, new Activity.Patrol(List.of("gate", "market"))),
              slot(20, 6, new Activity.Sleep("bed"))),
          Optional.of("inn"));

  private static Situation at(int hour, boolean storming) {
    return new Situation(TimeOfDay.of(hour, 0), storming);
  }

  @Test
  void withoutAScheduleAnNpcStandsAtHomeInItsPose() {
    var npc = npc("stan");
    assertThat(NpcBrain.decide(npc, Optional.empty(), PLACES, at(3, true)))
        .isEqualTo(new Intent.Stand(npc.home(), NpcPose.STANDING));
  }

  @Test
  void followsTheScheduleHourByHour() {
    var npc = npc("nat", Optional.of("day"));
    var schedule = Optional.of(DAY);
    assertThat(NpcBrain.decide(npc, schedule, PLACES, at(8, false)))
        .isEqualTo(new Intent.Stand(npc.home(), NpcPose.STANDING));
    assertThat(NpcBrain.decide(npc, schedule, PLACES, at(13, false)))
        .isEqualTo(new Intent.Wander(MARKET, 4));
    assertThat(NpcBrain.decide(npc, schedule, PLACES, at(17, false)))
        .isEqualTo(new Intent.Patrol(List.of(GATE, MARKET)));
    assertThat(NpcBrain.decide(npc, schedule, PLACES, at(2, false)))
        .isEqualTo(new Intent.Sleep(BED));
  }

  @Test
  void sheltersWhenStormingEvenAtNight() {
    var npc = npc("nat", Optional.of("day"));
    assertThat(NpcBrain.decide(npc, Optional.of(DAY), PLACES, at(13, true)))
        .isEqualTo(new Intent.Stand(INN, NpcPose.STANDING));
    assertThat(NpcBrain.decide(npc, Optional.of(DAY), PLACES, at(2, true)))
        .isEqualTo(new Intent.Stand(INN, NpcPose.STANDING));
  }

  @Test
  void aScheduleWithoutShelterIgnoresTheWeather() {
    var npc = npc("nat", Optional.of("dry"));
    var noShelter = new Schedule("dry", DAY.slots(), Optional.empty());
    assertThat(NpcBrain.decide(npc, Optional.of(noShelter), PLACES, at(13, true)))
        .isEqualTo(new Intent.Wander(MARKET, 4));
  }

  @Test
  void anUnknownPlaceIsABrokenInvariant() {
    var npc = npc("nat", Optional.of("lost"));
    var lost =
        new Schedule("lost", List.of(slot(0, 0, new Activity.Stay("nowhere"))), Optional.empty());
    assertThatThrownBy(() -> NpcBrain.decide(npc, Optional.of(lost), PLACES, at(1, false)))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void restingPoses() {
    assertThat(NpcBrain.restingPose(new Intent.Stand(spot(0, 0, 0), NpcPose.SNEAKING)))
        .isEqualTo(NpcPose.SNEAKING);
    assertThat(NpcBrain.restingPose(new Intent.Sleep(spot(0, 0, 0)))).isEqualTo(NpcPose.SLEEPING);
    assertThat(NpcBrain.restingPose(new Intent.Wander(spot(0, 0, 0), 3)))
        .isEqualTo(NpcPose.STANDING);
  }
}
