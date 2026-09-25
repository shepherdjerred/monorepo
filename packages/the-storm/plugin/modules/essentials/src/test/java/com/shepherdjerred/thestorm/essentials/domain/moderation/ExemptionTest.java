package com.shepherdjerred.thestorm.essentials.domain.moderation;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.essentials.domain.moderation.Exemption.Sender;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Exemption.Target;
import org.junit.jupiter.api.Test;

final class ExemptionTest {

  @Test
  void anOnlineExemptTargetIsRefusedForEveryone() {
    assertThat(Exemption.refusal(Sender.PLAYER, new Target.Online(true))).isPresent();
    assertThat(Exemption.refusal(Sender.CONSOLE, new Target.Online(true))).isPresent();
  }

  @Test
  void anOnlineOrdinaryTargetIsAllowed() {
    assertThat(Exemption.refusal(Sender.PLAYER, new Target.Online(false))).isEmpty();
    assertThat(Exemption.refusal(Sender.CONSOLE, new Target.Online(false))).isEmpty();
  }

  @Test
  void anOfflineTargetNeedsTheConsole() {
    assertThat(Exemption.refusal(Sender.PLAYER, new Target.Offline())).isPresent();
    assertThat(Exemption.refusal(Sender.CONSOLE, new Target.Offline())).isEmpty();
  }
}
