package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.RwfHarness;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.nio.file.Path;
import java.util.ArrayList;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class MatchRunnerStartupStopTest {
  @TempDir Path directory;

  @Test
  void stoppingBeforeAdmissionStillPublishesTheAcceptedStop() {
    try (var harness = RwfHarness.prepare(directory).enableBeforeLobby(directory)) {
      var runner = (MatchRunner) harness.view();
      assertThat(runner.current()).isEmpty();
      var notifications = new ArrayList<MatchNotification>();
      var subscription = runner.subscribe(notifications::add);
      runner.stop();
      subscription.close();

      assertThat(runner.current()).isEmpty();
      assertThat(notifications).hasSize(1);
      assertThat(notifications.getFirst().event()).isInstanceOf(MatchEvent.Stop.class);
      assertThat(notifications.getFirst().after().phase())
          .isEqualTo(MatchSnapshot.PhaseKind.RESETTING);
    }
  }
}
