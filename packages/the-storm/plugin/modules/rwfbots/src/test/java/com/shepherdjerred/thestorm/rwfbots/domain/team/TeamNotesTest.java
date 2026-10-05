package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** What bots tell their team: cover claims, chases and paths. */
final class TeamNotesTest {

  private static final CombatantId A = new CombatantId(1);
  private static final CombatantId B = new CombatantId(2);
  private static final CombatantId C = new CombatantId(3);
  private static final CombatantId ENEMY = new CombatantId(9);

  @Test
  void aNoteClaimsCoverAndAnEmptyNoteReleasesIt() {
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .note(A, new TeamNote(Optional.of(42), Optional.empty(), Set.of(1, 2)));
    assertThat(board.isCoverClaimed(42, B)).isTrue();
    assertThat(board.isCoverClaimed(42, A)).as("a bot's own claim is not in its way").isFalse();
    var released = board.note(A, TeamNote.NONE);
    assertThat(released.isCoverClaimed(42, B)).isFalse();
    assertThat(released.pathsOfOthers(B)).isEmpty();
  }

  @Test
  void chasesAreCountedPerEnemyAndForgottenWithIt() {
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .note(A, new TeamNote(Optional.empty(), Optional.of(ENEMY), Set.of()))
            .note(B, new TeamNote(Optional.empty(), Optional.of(ENEMY), Set.of()));
    assertThat(board.chasers(ENEMY, C)).isEqualTo(2);
    assertThat(board.chasers(ENEMY, A)).isEqualTo(1);
    assertThat(board.forget(ENEMY).chasers(ENEMY, C)).isZero();
  }

  @Test
  void pathsOfOthersLeaveOutTheAsker() {
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .note(A, new TeamNote(Optional.empty(), Optional.empty(), Set.of(1, 2)))
            .note(B, new TeamNote(Optional.empty(), Optional.empty(), Set.of(3)));
    assertThat(board.pathsOfOthers(A)).containsExactly(3);
    assertThat(board.pathsOfOthers(C)).containsExactlyInAnyOrder(1, 2, 3);
  }

  @Test
  void theDeadLeaveNoNotesBehind() {
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .note(A, new TeamNote(Optional.of(7), Optional.of(ENEMY), Set.of(1)))
            .dropNotes(A::equals);
    assertThat(board.claimedCover()).isEmpty();
    assertThat(board.chasing()).isEmpty();
    assertThat(board.paths()).isEmpty();
  }
}
