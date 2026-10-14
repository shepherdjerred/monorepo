package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.List;
import org.junit.jupiter.api.Test;

final class SightCloudTest {
  @Test
  void smokeBlocksCrossingRaysAndEndpointsInsideWhileLeavingNearbySightClear() {
    var smoke = List.of(new SightCloud(Vec3.ZERO, 4));
    assertThat(SightCloud.clear(smoke, new Vec3(-10, 0, 0), new Vec3(10, 0, 0))).isFalse();
    assertThat(SightCloud.clear(smoke, Vec3.ZERO, Vec3.ZERO)).isFalse();
    assertThat(SightCloud.clear(smoke, new Vec3(-10, 4.01, 0), new Vec3(10, 4.01, 0))).isTrue();
    assertThat(SightCloud.clear(List.of(), Vec3.ZERO, Vec3.ZERO)).isTrue();
  }
}
