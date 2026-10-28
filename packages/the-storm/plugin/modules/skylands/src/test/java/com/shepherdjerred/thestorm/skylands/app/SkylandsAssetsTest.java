package com.shepherdjerred.thestorm.skylands.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNullPointerException;

import java.util.HashMap;
import org.junit.jupiter.api.Test;

final class SkylandsAssetsTest {
  @Test
  void snapshotsCannotMutatePreparedResources() {
    var bytes = new byte[] {1, 2, 3};
    var original = new HashMap<String, byte[]>();
    original.put("native", bytes);
    var assets = new SkylandsAssets(original);
    bytes[0] = 4;
    original.clear();
    assets.template("native")[1] = 5;
    assertThat(assets.keys()).containsExactly("native");
    assertThat(assets.template("native")).containsExactly(1, 2, 3);
  }

  @Test
  void missingResourcesFailWithoutFallback() {
    var assets = new SkylandsAssets(java.util.Map.of());
    assertThatNullPointerException()
        .isThrownBy(() -> assets.template("missing"))
        .withMessage("Missing native Skylands bytes missing");
  }
}
