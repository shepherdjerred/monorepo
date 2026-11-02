package com.shepherdjerred.thestorm.towns.domain.protection;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The invite told to a visitor and the owner when an outsider is refused. */
final class FriendNoticeTest {

  private static final UUID OWNER = UUID.randomUUID();
  private static final UUID VISITOR = UUID.randomUUID();
  private static final Instant FOUNDED = Instant.EPOCH;

  @Test
  void aCampTellsBothSidesHowToInvite() {
    var camp = Town.camp(UUID.randomUUID(), "Lincbuggy", FOUNDED, OWNER);

    assertThat(FriendNotice.shouldAlert(camp, VISITOR, Action.INTERACT)).isTrue();
    assertThat(FriendNotice.shouldAlert(camp, OWNER, Action.INTERACT)).isFalse();
    assertThat(FriendNotice.visitor(camp, Action.INTERACT, "Lincbuggy"))
        .isEqualTo(
            "You can't use that in Lincbuggy's camp. Ask them to /camp invite you, then /camp join Lincbuggy.");
    assertThat(FriendNotice.owner(camp, Action.OPEN_CONTAINER, "starnith_"))
        .isEqualTo(
            "starnith_ can't open that in your camp. Invite them with /camp invite starnith_.");
  }

  @Test
  void aTownUsesTheTownInvite() {
    var town = Town.found(UUID.randomUUID(), "Harbor", FOUNDED, OWNER);

    assertThat(FriendNotice.visitor(town, Action.BUILD, "Harbor"))
        .isEqualTo("You can't build in Harbor. Ask them to /town invite you.");
    assertThat(FriendNotice.owner(town, Action.TELEPORT_INTO, "starnith_"))
        .isEqualTo(
            "starnith_ can't teleport in your town. Invite them with /town invite starnith_.");
    assertThat(FriendNotice.alerts(Action.SET_HOME)).isFalse();
  }
}
