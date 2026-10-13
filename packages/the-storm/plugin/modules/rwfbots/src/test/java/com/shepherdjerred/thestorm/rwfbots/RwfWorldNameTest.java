package com.shepherdjerred.thestorm.rwfbots;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
import org.junit.jupiter.api.Test;

final class RwfWorldNameTest {

  @Test
  void readsWorldIdentitiesAlongsideRwfOwnedProvisioning() {
    assertThat(
            StrictYaml.parse(
                "rwf.yml",
                "worlds:\n  lobby: rwf_lobby\n  maps: rwf\n  lobbyProvisioning: owned-void\n",
                RwfWorldName.class))
        .isEqualTo(Result.ok(new RwfWorldName(new RwfWorldName.Worlds("rwf_lobby", "rwf"))));
  }

  @Test
  void stillRequiresBothWorldIdentities() {
    assertThat(
            StrictYaml.parse(
                "rwf.yml",
                "worlds:\n  lobby: rwf_lobby\n  lobbyProvisioning: owned-void\n",
                RwfWorldName.class))
        .isInstanceOf(Result.Err.class);
  }
}
