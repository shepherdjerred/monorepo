package com.shepherdjerred.thestorm.npcs.domain.brain;

import com.shepherdjerred.thestorm.npcs.domain.behavior.Behavior;
import com.shepherdjerred.thestorm.npcs.domain.behavior.Behavior.Status;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Activity;
import com.shepherdjerred.thestorm.npcs.domain.schedule.Schedule;
import com.shepherdjerred.thestorm.npcs.domain.schedule.TimeOfDay;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.jspecify.annotations.Nullable;

/**
 * Chooses an NPC's {@link Intent} from its schedule, the time of day and the weather, with a small
 * behavior tree: shelter from a storm if the schedule names a shelter; otherwise follow the
 * schedule; otherwise stand at home.
 */
public final class NpcBrain {

  /** The place id that always means the NPC's own home. */
  public static final String HOME = "home";

  private static final Behavior<Mind> TREE =
      Behavior.selector(
          List.of(
              Behavior.sequence(
                  List.of(
                      Behavior.condition(Mind::shouldShelter),
                      Behavior.action(mind -> mind.choose(mind.shelter())))),
              Behavior.sequence(
                  List.of(
                      Behavior.condition(mind -> mind.schedule.isPresent()),
                      Behavior.action(mind -> mind.choose(mind.scheduled())))),
              Behavior.action(mind -> mind.choose(mind.home()))));

  private NpcBrain() {}

  /**
   * What {@code npc} should be doing.
   *
   * @param places the content's named places; every place the schedule names must be here or be
   *     {@link #HOME}
   */
  public static Intent decide(
      NpcDefinition npc, Optional<Schedule> schedule, Map<String, Spot> places, Situation now) {
    var mind = new Mind(npc, schedule, places, now);
    TREE.tick(mind);
    return mind.chosen();
  }

  /**
   * The world around an NPC.
   *
   * @param time the time of day in the NPC's world
   * @param storming whether it is raining or storming there
   */
  public record Situation(TimeOfDay time, boolean storming) {}

  /** The tree's scratch space for one decision. */
  private static final class Mind {

    private final NpcDefinition npc;
    private final Optional<Schedule> schedule;
    private final Map<String, Spot> places;
    private final Situation now;
    private @Nullable Intent chosen;

    Mind(NpcDefinition npc, Optional<Schedule> schedule, Map<String, Spot> places, Situation now) {
      this.npc = npc;
      this.schedule = schedule;
      this.places = places;
      this.now = now;
    }

    Status choose(Intent intent) {
      chosen = intent;
      return Status.SUCCESS;
    }

    Intent chosen() {
      if (chosen == null) {
        throw new IllegalStateException("the brain's last branch always chooses");
      }
      return chosen;
    }

    boolean shouldShelter() {
      return now.storming() && schedule.flatMap(Schedule::shelter).isPresent();
    }

    Intent shelter() {
      var place = schedule.flatMap(Schedule::shelter).orElseThrow();
      return new Intent.Stand(spot(place), npc.pose());
    }

    Intent scheduled() {
      var activity = schedule.orElseThrow().activityAt(now.time());
      return switch (activity) {
        case Activity.Stay(var place) -> new Intent.Stand(spot(place), npc.pose());
        case Activity.Wander(var place, var radius) -> new Intent.Wander(spot(place), radius);
        case Activity.Patrol(var route) ->
            new Intent.Patrol(route.stream().map(this::spot).toList());
        case Activity.Sleep(var place) -> new Intent.Sleep(spot(place));
      };
    }

    Intent home() {
      return new Intent.Stand(npc.home(), npc.pose());
    }

    private Spot spot(String place) {
      if (HOME.equals(place)) {
        return npc.home();
      }
      var spot = places.get(place);
      if (spot == null) {
        throw new IllegalStateException("validated content lost place " + place);
      }
      return spot;
    }
  }

  /** The pose an intent holds once it has arrived. */
  public static NpcPose restingPose(Intent intent) {
    return switch (intent) {
      case Intent.Stand(var _, var pose) -> pose;
      case Intent.Sleep _ -> NpcPose.SLEEPING;
      case Intent.Wander _, Intent.Patrol _ -> NpcPose.STANDING;
    };
  }
}
