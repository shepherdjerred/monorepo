package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class CombatHarnessTest {
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

  private static final class Passthrough implements CombatHarness.Controller {
    private final java.util.ArrayList<Long> captured = new java.util.ArrayList<>();
    private final java.util.ArrayList<Long> finished = new java.util.ArrayList<>();

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
      return authored;
    }

    @Override
    public List<BodyCommand> commands(CombatHarness.Frame frame) {
      return frame.authored().commands();
    }
  }
}
