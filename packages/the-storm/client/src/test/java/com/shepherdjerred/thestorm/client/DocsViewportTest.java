package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class DocsViewportTest {
  @Test
  void usesTheSamePhysicalSizeOnOrdinaryAndRetinaDisplays() {
    assertThat(DocsViewport.target()).isEqualTo(new DocsViewport.Size(1280, 720));
    assertThat(DocsViewport.windowedSize(1280, 720, 1280, 720))
        .isEqualTo(new DocsViewport.Size(1280, 720));
    assertThat(DocsViewport.windowedSize(1280, 720, 2560, 1440))
        .isEqualTo(new DocsViewport.Size(640, 360));
    assertThat(DocsViewport.windowedSize(640, 360, 1280, 720))
        .isEqualTo(new DocsViewport.Size(640, 360));
  }

  @Test
  void refusesAnUnavailableFramebufferInsteadOfDividingByZero() {
    assertThatThrownBy(() -> DocsViewport.windowedSize(1280, 720, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
