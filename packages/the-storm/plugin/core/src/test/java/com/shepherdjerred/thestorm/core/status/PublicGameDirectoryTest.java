package com.shepherdjerred.thestorm.core.status;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class PublicGameDirectoryTest {
  @Test
  void replacesEachModuleSnapshotWithoutExposingMutableLists() {
    var directory = new PublicGameDirectory();
    var arena = game("arena", PublicGameDirectory.Kind.ARENA);
    var rwf = game("rwf", PublicGameDirectory.Kind.RWF);

    directory.replace(PublicGameDirectory.Kind.ARENA, List.of(arena));
    var firstSnapshot = directory.snapshot();
    directory.replace(PublicGameDirectory.Kind.RWF, List.of(rwf));
    directory.replace(PublicGameDirectory.Kind.ARENA, List.of());

    assertThat(firstSnapshot).containsExactly(arena);
    assertThat(directory.snapshot()).containsExactly(rwf);
    assertThatThrownBy(() -> directory.snapshot().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> directory.replace(PublicGameDirectory.Kind.ARENA, List.of(rwf)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private static PublicGameDirectory.Game game(String id, PublicGameDirectory.Kind kind) {
    return new PublicGameDirectory.Game(
        id,
        kind,
        id,
        PublicGameDirectory.Phase.RUNNING,
        "",
        List.of(UUID.fromString("00000000-0000-0000-0000-000000000001")));
  }
}
