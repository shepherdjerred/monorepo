package com.shepherdjerred.thestorm.core.snapshot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import org.junit.jupiter.api.Test;

/** Player-file writes from every game share one pace: one a tick. */
final class SavePacerTest {

  private final ManualScheduler main = new ManualScheduler();
  private final SavePacer pacer = new SavePacer(main);
  private final ArrayList<String> written = new ArrayList<>();

  @Test
  void writesFromSeveralGamesInOneTickRunOneATick() {
    pacer.submit(() -> written.add("arena: Alice"));
    pacer.submit(() -> written.add("rwf: Bob"));
    pacer.submit(() -> written.add("rwf: Carol"));

    assertThat(written).containsExactly("arena: Alice");
    main.runFor(SavePacer.SPACING);
    assertThat(written).containsExactly("arena: Alice", "rwf: Bob");
    main.runFor(SavePacer.SPACING);
    assertThat(written).containsExactly("arena: Alice", "rwf: Bob", "rwf: Carol");
  }

  @Test
  void aWriteAfterAQuietTickRunsAtOnceButNotTwiceInATick() {
    pacer.submit(() -> written.add("first"));
    main.runFor(SavePacer.SPACING.multipliedBy(3));

    pacer.submit(() -> written.add("second"));
    pacer.submit(() -> written.add("third"));

    assertThat(written).containsExactly("first", "second");
    main.runFor(SavePacer.SPACING);
    assertThat(written).containsExactly("first", "second", "third");
  }

  @Test
  void aFailingWriteDoesNotStopTheOnesAfterIt() {
    pacer.submit(() -> written.add("before"));
    pacer.submit(
        () -> {
          throw new IllegalStateException("disk full");
        });
    pacer.submit(() -> written.add("after"));

    // The failure surfaces in the tick that ran it; the queue carries on.
    assertThatThrownBy(() -> main.runFor(SavePacer.SPACING))
        .isInstanceOf(IllegalStateException.class);
    main.runFor(SavePacer.SPACING);

    assertThat(written).containsExactly("before", "after");
  }
}
