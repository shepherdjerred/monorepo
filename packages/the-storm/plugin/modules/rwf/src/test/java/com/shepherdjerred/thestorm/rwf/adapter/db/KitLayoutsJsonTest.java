package com.shepherdjerred.thestorm.rwf.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitLayout;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class KitLayoutsJsonTest {

  @Test
  void layoutsRoundTripInOrder() {
    var layouts =
        Map.of(
            "trooper", new KitLayout(Map.of(0, 0, 1, 2, 2, 1)),
            "longbow", new KitLayout(Map.of(0, 0, 1, 1, 2, 3, 3, 9)));

    var json = KitLayoutsJson.write(layouts);

    assertThat(json)
        .isEqualTo(
            "{\"longbow\":{\"0\":0,\"1\":1,\"2\":3,\"3\":9},\"trooper\":{\"0\":0,\"1\":2,\"2\":1}}");
    assertThat(KitLayoutsJson.read(json)).isEqualTo(layouts);
    assertThat(KitLayoutsJson.read("{}")).isEmpty();
  }

  @Test
  void aMalformedColumnFailsLoudly() {
    assertThatThrownBy(() -> KitLayoutsJson.read("[]")).isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> KitLayoutsJson.read("{\"trooper\":{\"0\":\"x\"}}"))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> KitLayoutsJson.read("{\"trooper\":{\"0\":0,\"1\":0}}"))
        .as("two items in one slot")
        .isInstanceOf(IllegalArgumentException.class);
  }
}
