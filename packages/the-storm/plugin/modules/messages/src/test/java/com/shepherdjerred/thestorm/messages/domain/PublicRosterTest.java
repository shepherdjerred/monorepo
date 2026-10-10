package com.shepherdjerred.thestorm.messages.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

final class PublicRosterTest {
  private static final UUID HUMAN = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final UUID STAFF = UUID.fromString("00000000-0000-0000-0000-000000000002");
  private static final UUID NPC = UUID.fromString("00000000-0000-0000-0000-000000000003");

  @Test
  void publishesOnlyVisibleHumansAndPreservesBedrockNames() {
    var roster = new PublicRoster();
    roster.joined(HUMAN, ".Bedrock Player", true);
    roster.joined(STAFF, "Staff", true);
    roster.joined(NPC, "Citizen", false);
    assertThat(roster.names(true, STAFF::equals)).containsExactly(".Bedrock Player");
    assertThat(roster.names(true, id -> false)).containsExactly(".Bedrock Player", "Staff");
    roster.left(HUMAN);
    assertThat(roster.names(true, STAFF::equals)).isEmpty();
  }

  @Test
  void suppressesStartupRosterAndDoesNotMutateCapturedSnapshots() {
    var roster = new PublicRoster();
    roster.joined(HUMAN, "Human", true);
    assertThat(roster.names(false, id -> false)).isEmpty();
    var captured = roster.names(true, id -> false);
    roster.left(HUMAN);
    assertThat(captured).containsExactly("Human");
    assertThat(roster.names(true, id -> false)).isEmpty();
    roster.joined(HUMAN, "Human", true);
    roster.joined(HUMAN, "Citizen", false);
    assertThat(roster.names(true, id -> false)).isEmpty();
  }
}
