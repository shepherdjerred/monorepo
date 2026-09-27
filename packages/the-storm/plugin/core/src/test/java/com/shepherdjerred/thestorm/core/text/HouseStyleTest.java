package com.shepherdjerred.thestorm.core.text;

import static org.assertj.core.api.Assertions.assertThat;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.Test;

final class HouseStyleTest {

  @Test
  void framesTheLabel() {
    var message = HouseStyle.info("Shards", Component.text("It is raining at the windmill."));

    assertThat(PlainTextComponentSerializer.plainText().serialize(message))
        .isEqualTo("[Shards]: It is raining at the windmill.");
  }

  @Test
  void usesTheBrandTealForTheLabel() {
    var message = HouseStyle.error("Towns", Component.text("You can't build here."));

    assertThat(message.children().get(0).color()).isEqualTo(HouseStyle.BRAND);
  }
}
