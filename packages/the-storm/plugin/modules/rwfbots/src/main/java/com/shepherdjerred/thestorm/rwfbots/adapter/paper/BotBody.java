package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwfbots.app.BotProfile;
import com.shepherdjerred.thestorm.rwfbots.app.Director;
import com.shepherdjerred.thestorm.rwfbots.app.Loadouts;
import com.shepherdjerred.thestorm.rwfbots.app.PersonalityStats;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * One bot the roster handed to the match, from draft to despawn: who it is, how it plays, and the
 * main-thread state its reflex layer carries between ticks. Main thread only.
 */
public final class BotBody {

  private final UUID uuid;
  private final Director.Drafted drafted;
  private final Loadout loadout;
  private @Nullable BotProfile profile;
  private ReflexState reflex = ReflexState.initial(Facing.SOUTH);
  private SplittableRandom random = new SplittableRandom(0);
  private PersonalityStats.Tally tally = PersonalityStats.Tally.NONE;
  private long drawStart = -1;
  private Optional<ActionRefusal> lastRefusal = Optional.empty();
  private int refusals;
  private String planLabel = "-";
  private long decisionAge;

  BotBody(UUID uuid, Director.Drafted drafted) {
    this.uuid = uuid;
    this.drafted = drafted;
    this.loadout = Loadouts.rwf(drafted.kit());
  }

  public UUID uuid() {
    return uuid;
  }

  public Director.Drafted drafted() {
    return drafted;
  }

  public String personalityId() {
    return drafted.personality().id();
  }

  public String name() {
    return drafted.personality().name();
  }

  public Loadout loadout() {
    return loadout;
  }

  /** The match profile, once the bot has a team and the match is live. */
  public Optional<BotProfile> profile() {
    return Optional.ofNullable(profile);
  }

  void profile(BotProfile assigned, long seed) {
    profile = assigned;
    random = new SplittableRandom(seed);
    reflex = ReflexState.initial(Facing.SOUTH);
    tally = PersonalityStats.Tally.NONE;
    drawStart = -1;
  }

  void leaveMatch() {
    profile = null;
  }

  ReflexState reflex() {
    return reflex;
  }

  void reflex(ReflexState next) {
    reflex = next;
  }

  /** The reflex layer's random source, deterministic per life. */
  SplittableRandom random() {
    return random;
  }

  /** A new life: the reflex starts over looking along {@code facing}. */
  void newLife(Facing facing) {
    reflex = ReflexState.initial(facing);
    drawStart = -1;
  }

  public PersonalityStats.Tally tally() {
    return tally;
  }

  void tally(PersonalityStats.Tally next) {
    tally = next;
  }

  long drawStart() {
    return drawStart;
  }

  void drawStart(long tick) {
    drawStart = tick;
  }

  public Optional<ActionRefusal> lastRefusal() {
    return lastRefusal;
  }

  public int refusals() {
    return refusals;
  }

  void refused(ActionRefusal refusal) {
    lastRefusal = Optional.of(refusal);
    refusals++;
  }

  public String planLabel() {
    return planLabel;
  }

  public long decisionAge() {
    return decisionAge;
  }

  void followed(String label, long age) {
    planLabel = label;
    decisionAge = age;
  }
}
