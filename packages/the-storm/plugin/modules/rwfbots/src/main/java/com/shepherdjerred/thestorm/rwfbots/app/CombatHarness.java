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
  private long seed;

  public void attach(long experimentSeed, Controller experiment) {
    if (controller.isPresent()) throw new IllegalStateException("experiment already attached");
    seed = experimentSeed;
    controller = Optional.of(experiment);
    match = Optional.empty();
  }

  public void detach() {
    controller = Optional.empty();
    match = Optional.empty();
  }

  public Optional<List<Director.Drafted>> draft(
      UUID matchId, int slots, PersonalityCatalog catalog) {
    if (controller.isEmpty() || match.isPresent()) return Optional.empty();
    if (slots != 2) throw new IllegalArgumentException("combat experiment needs exactly two bots");
    var identities =
        catalog.active().stream().sorted(Comparator.comparing(p -> p.id())).limit(2).toList();
    if (identities.size() != 2)
      throw new IllegalStateException("combat experiment needs two identities");
    match = Optional.of(matchId);
    return Optional.of(
        identities.stream()
            .map(p -> new Director.Drafted(p, Kit.TROOPER, LeverCurves.at(1), Rating.DEFAULT))
            .toList());
  }

  public boolean active(UUID matchId) {
    return controller.isPresent() && match.filter(matchId::equals).isPresent();
  }

  public void captureTick(UUID matchId, long tick) {
    if (active(matchId)) controller.orElseThrow().captureTick(tick);
  }

  public OptionalLong seed(UUID matchId) {
    return active(matchId) ? OptionalLong.of(seed) : OptionalLong.empty();
  }

  public ReflexInput input(
      UUID matchId,
      ReflexInput authored,
      com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact nav) {
    return active(matchId) ? controller.orElseThrow().input(authored, nav) : authored;
  }

  public List<BodyCommand> commands(Frame frame) {
    return active(frame.matchId())
        ? controller.orElseThrow().commands(frame)
        : frame.authored().commands();
  }
}
