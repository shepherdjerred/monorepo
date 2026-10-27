package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class NetworkAccessTest {
  private static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final UUID INVITED = UUID.fromString("00000000-0000-0000-0000-000000000002");
  private static final UUID OTHER = UUID.fromString("00000000-0000-0000-0000-000000000003");

  @Test
  void publicNetworksAllowEveryone() {
    assertThat(new NetworkAccess.Public().permits(OTHER, _ -> false)).isTrue();
  }

  @Test
  void privateNetworksAllowOwnerAndInvitedPlayersOnly() {
    var access = new NetworkAccess.Private(OWNER, Set.of(INVITED));
    assertThat(access.permits(OWNER, _ -> false)).isTrue();
    assertThat(access.permits(INVITED, _ -> false)).isTrue();
    assertThat(access.permits(OTHER, _ -> true)).isFalse();
    assertThat(access.mayInvite(OWNER)).isTrue();
    assertThat(access.mayInvite(INVITED)).isFalse();
  }

  @Test
  void invitationsAreNotChangedThroughTheOriginalSet() {
    var invited = new HashSet<UUID>();
    var access = new NetworkAccess.Private(OWNER, invited);
    invited.add(OTHER);
    assertThat(access.permits(OTHER, _ -> false)).isFalse();
  }

  @Test
  void townMembershipIsRecheckedForEachUse() {
    var access = new NetworkAccess.Town(OWNER);
    assertThat(access.permits(OTHER, OWNER::equals)).isTrue();
    assertThat(access.permits(OTHER, OTHER::equals)).isFalse();
    assertThat(access.mayInvite(OWNER)).isFalse();
  }
}
