package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class CombatHarnessTest {
  @Test
  void seededLearningBaselineMatchesOrdinaryHardCompetenceAndPreservesLegacyDiagnostics() {
    var catalog =
        new PersonalityCatalog(
            List.of(
                Fixtures.personality("alpha", "Alpha", .8),
                Fixtures.personality("beta", "Beta", .2)));
    var harness = new CombatHarness();
    var match = new UUID(1, 2);
    harness.attachBaseline(42, new Passthrough());
    var drafted = harness.draft(match, 2, catalog).orElseThrow();
    var experience =
        new com.shepherdjerred.thestorm.rwf.app.MatchExperiences.Frozen(
            match, 42, com.shepherdjerred.thestorm.rwf.app.ExperienceSettings.DEFAULT);
    var request =
        new Director.Request(
            catalog,
            java.util.Map.of(),
            List.of(),
            2,
            java.util.Set.of(),
            java.util.Set.of(Kit.TROOPER),
            2,
            0);
    var ordinary = Director.pick(request, experience, new java.util.SplittableRandom(42));
    var expected =
        ordinary.bots().stream()
            .collect(
                java.util.stream.Collectors.toUnmodifiableMap(
                    bot -> bot.personality().id(), Director.Drafted::levers));
    assertThat(drafted)
        .allSatisfy(
            bot -> assertThat(bot.levers()).isEqualTo(expected.get(bot.personality().id())));
    assertThat(harness.baseline(match)).contains(CombatHarness.AUTHORED_BASELINE);
    harness.detach();
    assertThat(harness.baseline(match)).isEmpty();
    harness.attach(43, new Passthrough());
    assertThat(harness.draft(match, 2, catalog).orElseThrow())
        .allSatisfy(bot -> assertThat(bot.levers().technique()).isEqualTo(1.0));
    assertThat(harness.baseline(match)).isEmpty();
  }

  @Test
  void attachmentBindsOnceAndLeavesSuccessorMatchesUntouched() {
    var harness = new CombatHarness();
    var first = new UUID(1, 2);
    var second = new UUID(3, 4);
    var catalog =
        new PersonalityCatalog(
            List.of(
                Fixtures.personality("beta", "Beta", .2),
                Fixtures.personality("alpha", "Alpha", .8)));
    assertThat(harness.draft(first, 2, catalog)).isEmpty();
    var controller = new Passthrough();
    harness.attach(42, controller);
    harness.captureTick(first, 10);
    harness.finishTick(first, 10);
    assertThatIllegalStateException().isThrownBy(() -> harness.attach(43, new Passthrough()));
    var drafted = harness.draft(first, 2, catalog).orElseThrow();
    assertThat(drafted).extracting(d -> d.personality().id()).containsExactly("alpha", "beta");
    assertThat(drafted).extracting(Director.Drafted::kit).containsOnly(Kit.TROOPER);
    assertThat(drafted).extracting(d -> d.levers().technique()).containsOnly(1.0);
    assertThat(harness.seed(first)).hasValue(42);
    assertThat(harness.controlled(first)).isTrue();
    assertThat(harness.controlled(second)).isFalse();
    assertThat(harness.active(second)).isFalse();
    assertThat(harness.draft(second, 2, catalog)).isEmpty();
    harness.captureTick(first, 11);
    harness.finishTick(first, 11);
    harness.captureTick(second, 12);
    harness.finishTick(second, 12);
    harness.detach();
    harness.captureTick(first, 13);
    harness.finishTick(first, 13);
    assertThat(controller.captured).containsExactly(11L);
    assertThat(controller.finished).containsExactly(11L);
    assertThat(harness.active(first)).isFalse();
    harness.attach(43, new Passthrough());
    assertThat(harness.draft(second, 2, catalog)).isPresent();
    assertThat(harness.seed(second)).hasValue(43);
  }

  @Test
  void loadAttachmentRequiresItsExactRosterAndLeavesSuccessorsUntouched() {
    var harness = new CombatHarness();
    var catalog =
        new PersonalityCatalog(
            java.util.stream.IntStream.range(0, 100)
                .mapToObj(
                    index ->
                        Fixtures.personality("body-" + index, "Body" + index + "x" + index, .5))
                .toList());
    for (var size : List.of(20, 50, 100)) {
      harness.attach(42, size, new Passthrough());
      var match = new UUID(0, size);
      assertThatIllegalArgumentException().isThrownBy(() -> harness.draft(match, 2, catalog));
      assertThat(harness.draft(match, size, catalog).orElseThrow()).hasSize(size);
      assertThat(harness.draft(new UUID(1, size), size, catalog)).isEmpty();
      harness.detach();
    }
    assertThatIllegalArgumentException()
        .isThrownBy(() -> harness.attach(1, 101, new Passthrough()));
    harness.attach(1, new Passthrough());
    assertThatIllegalArgumentException()
        .isThrownBy(() -> harness.draft(new UUID(0, 1), 20, catalog));
  }

  @Test
  void authoredAttachmentBindsWithoutAnExperimentalDraftSeedOrInputOverride() {
    var harness = new CombatHarness();
    var first = new UUID(1, 2);
    var second = new UUID(3, 4);
    var catalog = new PersonalityCatalog(List.of());
    var controller = new Passthrough();
    harness.attachAuthored(1, controller);
    assertThatIllegalArgumentException().isThrownBy(() -> harness.draft(first, 2, catalog));
    assertThat(harness.active(first)).isFalse();
    assertThat(harness.draft(first, 1, catalog)).isEmpty();
    assertThat(harness.active(first)).isTrue();
    assertThat(harness.controlled(first)).isFalse();
    assertThat(harness.seed(first)).isEmpty();
    assertThat(harness.draft(second, 1, catalog)).isEmpty();
    assertThat(harness.active(second)).isFalse();
    assertThatIllegalStateException().isThrownBy(() -> harness.attach(42, new Passthrough()));

    var self = Fixtures.combatant(1, Fixtures.RED, new Vec3(2.5, 1, 2.5));
    var input =
        new ReflexInput(
            self,
            new WorldSnapshot(
                11,
                MatchPhase.LIVE,
                List.of(self),
                List.of(),
                PoisonView.NONE,
                "test",
                List.of(),
                List.of()),
            Decision.idle(self.id(), 11, 0),
            Optional.empty(),
            3,
            List.of());
    assertThat(harness.input(first, input, SyntheticMap.bake())).isSameAs(input);
    assertThat(controller.inputCalls).isZero();
    var authored =
        new Reflex.Step(ReflexState.initial(Facing.SOUTH), List.of(new BodyCommand.Stop()));
    var frame =
        new CombatHarness.Frame(
            first,
            new UUID(5, 6),
            0,
            input,
            Optional.empty(),
            authored,
            Optional.empty(),
            SyntheticMap.bake());
    harness.captureTick(first, 11);
    assertThat(harness.commands(frame)).isSameAs(authored.commands());
    harness.finishTick(first, 11);
    harness.captureTick(second, 12);
    harness.finishTick(second, 12);
    assertThat(controller.frames).containsExactly(frame);
    harness.detach();
    assertThat(harness.commands(frame)).isSameAs(authored.commands());
    assertThat(controller.frames).containsExactly(frame);
    assertThat(harness.active(first)).isFalse();
    assertThat(controller.captured).containsExactly(11L);
    assertThat(controller.finished).containsExactly(11L);
    harness.attach(43, new Passthrough());
    assertThatIllegalStateException().isThrownBy(() -> harness.draft(second, 2, catalog));
    assertThat(harness.active(second)).isFalse();
    var controlledCatalog =
        new PersonalityCatalog(
            List.of(
                Fixtures.personality("alpha", "Alpha", .8),
                Fixtures.personality("beta", "Beta", .2)));
    assertThat(harness.draft(second, 2, controlledCatalog)).isPresent();
    assertThat(harness.controlled(second)).isTrue();
    assertThat(harness.seed(second)).hasValue(43);
  }

  @Test
  void authoredAttachmentsRejectInvalidRosterSizes() {
    var harness = new CombatHarness();
    for (var size : List.of(0, -1, 101))
      assertThatIllegalArgumentException()
          .isThrownBy(() -> harness.attachAuthored(size, new Passthrough()));
    harness.attachAuthored(100, new Passthrough());
    assertThat(harness.draft(new UUID(1, 2), 100, new PersonalityCatalog(List.of()))).isEmpty();
    assertThat(harness.active(new UUID(1, 2))).isTrue();
  }

  @Test
  void recordedAuthoredCohortKeepsItsOrderKitsAndOrdinaryCompetenceForOnlyOneMatch() {
    var first = new UUID(1, 2);
    var successor = new UUID(3, 4);
    var alpha = Fixtures.personality("alpha", "Alpha", .8);
    var beta = Fixtures.personality("beta", "Beta", .2);
    var settings = com.shepherdjerred.thestorm.rwf.app.ExperienceSettings.DEFAULT;
    var recorded =
        new java.util.ArrayList<>(
            List.of(
                new Director.Drafted(
                    beta,
                    Kit.LONGBOW,
                    MatchCompetence.levers(beta, settings, 42),
                    com.shepherdjerred.thestorm.rwfbots.domain.director.Rating.DEFAULT,
                    MatchCompetence.style(beta, settings)),
                new Director.Drafted(
                    alpha,
                    Kit.REWIND,
                    MatchCompetence.levers(alpha, settings, 42),
                    com.shepherdjerred.thestorm.rwfbots.domain.director.Rating.DEFAULT,
                    MatchCompetence.style(alpha, settings))));
    var expected = List.copyOf(recorded);
    var harness = new CombatHarness();
    harness.attachAuthored(recorded, new Passthrough());
    recorded.clear();
    assertThatIllegalArgumentException()
        .isThrownBy(() -> harness.draft(first, 2, new PersonalityCatalog(List.of(alpha))));
    assertThat(harness.active(first)).isFalse();
    var catalog = new PersonalityCatalog(List.of(alpha, beta));
    assertThat(harness.draft(first, 2, catalog)).contains(expected);
    assertThat(harness.controlled(first)).isFalse();
    assertThat(harness.seed(first)).isEmpty();
    assertThat(harness.baseline(first)).isEmpty();
    assertThat(expected).allSatisfy(bot -> assertThat(bot.levers().technique()).isLessThan(1));
    assertThat(harness.draft(successor, 2, catalog)).isEmpty();
    assertThat(harness.active(successor)).isFalse();
    harness.detach();
    harness.attachAuthored(2, new Passthrough());
    assertThat(harness.draft(successor, 2, catalog)).isEmpty();
    assertThat(harness.active(successor)).isTrue();
  }

  @Test
  void recordedAuthoredCohortRejectsDuplicateIdentitiesBeforeAttaching() {
    var personality = Fixtures.personality("alpha", "Alpha", .8);
    var draft =
        new Director.Drafted(
            personality,
            Kit.TROOPER,
            MatchCompetence.levers(
                personality, com.shepherdjerred.thestorm.rwf.app.ExperienceSettings.DEFAULT, 42),
            com.shepherdjerred.thestorm.rwfbots.domain.director.Rating.DEFAULT);
    var harness = new CombatHarness();
    assertThatIllegalArgumentException()
        .isThrownBy(() -> harness.attachAuthored(List.of(draft, draft), new Passthrough()));
    harness.attachAuthored(List.of(draft), new Passthrough());
    assertThat(harness.draft(new UUID(1, 2), 1, new PersonalityCatalog(List.of(personality))))
        .contains(List.of(draft));
  }

  private static final class Passthrough implements CombatHarness.Controller {
    private final java.util.ArrayList<Long> captured = new java.util.ArrayList<>();
    private final java.util.ArrayList<Long> finished = new java.util.ArrayList<>();
    private final java.util.ArrayList<CombatHarness.Frame> frames = new java.util.ArrayList<>();
    private int inputCalls;

    @Override
    public void captureTick(long tick) {
      captured.add(tick);
    }

    @Override
    public void finishTick(long tick) {
      finished.add(tick);
    }

    @Override
    public ReflexInput input(ReflexInput authored, NavArtifact nav) {
      inputCalls++;
      return authored;
    }

    @Override
    public List<BodyCommand> commands(CombatHarness.Frame frame) {
      frames.add(frame);
      return frame.authored().commands();
    }
  }
}
