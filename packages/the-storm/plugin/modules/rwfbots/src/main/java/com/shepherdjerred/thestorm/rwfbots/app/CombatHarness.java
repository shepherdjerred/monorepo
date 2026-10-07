package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;

/**
 * Main-thread controller attachment for disposable Paper experiments. Normal matches have no
 * attachment. The transport and experiment live in the separate fixtures jar, never TheStorm.jar.
 * One attachment binds to exactly one match and cannot affect its successor.
 */
public final class CombatHarness {
  public interface Controller {
    /** Capture evaluation totals before any body executes this world's commands. */
    void captureTick(long tick);

    /** Submit a batch only after all current bodies have supplied their fair observations. */
    default void finishTick(long tick) {}

    ReflexInput input(
        ReflexInput authored, com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact nav);

    List<BodyCommand> commands(Frame frame);
  }

  public record Frame(
      UUID matchId,
      UUID body,
      int life,
      ReflexInput input,
      Reflex.Step authored,
      Optional<com.shepherdjerred.thestorm.rwf.app.ObservationSource.Sample> observation) {}

  private Optional<Controller> controller = Optional.empty();
  private Optional<UUID> match = Optional.empty();
  private OptionalLong seed = OptionalLong.empty();
  private int combatants;

  public void attach(long experimentSeed, Controller experiment) {
    attach(experimentSeed, 2, experiment);
  }

  /** Explicit roster size for disposable native inference load experiments. */
  public void attach(long experimentSeed, int experimentCombatants, Controller experiment) {
    if (experimentCombatants < 2 || experimentCombatants > 100)
      throw new IllegalArgumentException("combat experiment needs 2..100 bots");
    attach(OptionalLong.of(experimentSeed), experimentCombatants, experiment);
  }

  /**
   * Attaches a controller to one ordinary draft in a disposable regression server. Roster picks,
   * lobby kit plans, difficulty, randomness, habits, governor thinning and settlement remain
   * authored. The controller receives unchanged reflex inputs and may replace body commands.
   */
  public void attachAuthored(int experimentCombatants, Controller experiment) {
    if (experimentCombatants < 1 || experimentCombatants > 100)
      throw new IllegalArgumentException("authored experiment needs 1..100 bots");
    attach(OptionalLong.empty(), experimentCombatants, experiment);
  }

  private void attach(
      OptionalLong experimentSeed, int experimentCombatants, Controller experiment) {
    if (controller.isPresent()) throw new IllegalStateException("experiment already attached");
    seed = experimentSeed;
    combatants = experimentCombatants;
    controller = Optional.of(experiment);
    match = Optional.empty();
  }

  public void detach() {
    controller = Optional.empty();
    match = Optional.empty();
    seed = OptionalLong.empty();
  }

  public Optional<List<Director.Drafted>> draft(
      UUID matchId, int slots, PersonalityCatalog catalog) {
    if (controller.isEmpty() || match.isPresent()) return Optional.empty();
    if (slots != combatants)
      throw new IllegalArgumentException("combat experiment roster size differs");
    if (seed.isEmpty()) {
      match = Optional.of(matchId);
      return Optional.empty();
    }
    var identities =
        catalog.active().stream()
            .sorted(Comparator.comparing(p -> p.id()))
            .limit(combatants)
            .toList();
    if (identities.size() != combatants)
      throw new IllegalStateException("combat experiment lacks identities");
    match = Optional.of(matchId);
    return Optional.of(
        identities.stream()
            .map(p -> new Director.Drafted(p, Kit.TROOPER, LeverCurves.at(1), Rating.DEFAULT))
            .toList());
  }

  public boolean active(UUID matchId) {
    return controller.isPresent() && match.filter(matchId::equals).isPresent();
  }

  /** Whether this match uses the controlled Trooper environment instead of ordinary gameplay. */
  public boolean controlled(UUID matchId) {
    return active(matchId) && seed.isPresent();
  }

  public void captureTick(UUID matchId, long tick) {
    if (active(matchId)) controller.orElseThrow().captureTick(tick);
  }

  public void finishTick(UUID matchId, long tick) {
    if (active(matchId)) controller.orElseThrow().finishTick(tick);
  }

  public OptionalLong seed(UUID matchId) {
    return active(matchId) ? seed : OptionalLong.empty();
  }

  public ReflexInput input(
      UUID matchId,
      ReflexInput authored,
      com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact nav) {
    return controlled(matchId) ? controller.orElseThrow().input(authored, nav) : authored;
  }

  public List<BodyCommand> commands(Frame frame) {
    return active(frame.matchId())
        ? controller.orElseThrow().commands(frame)
        : frame.authored().commands();
  }
}
