package com.shepherdjerred.thestorm.creative.adapter.bluemap;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class PlotNameHtmlTest {

  @Test
  void aNameIsCenteredTextThatIgnoresMapClicks() {
    var html = PlotNameHtml.of("BenTheGamer78");

    assertThat(html).contains("BenTheGamer78");
    assertThat(html).contains("pointer-events:none");
    assertThat(html).contains("translate(-50%,-50%)");
  }

  @Test
  void markupInAPlotNameIsEscaped() {
    assertThat(PlotNameHtml.of("a<b>&\"c")).contains("a&lt;b&gt;&amp;&quot;c");
  }
}
