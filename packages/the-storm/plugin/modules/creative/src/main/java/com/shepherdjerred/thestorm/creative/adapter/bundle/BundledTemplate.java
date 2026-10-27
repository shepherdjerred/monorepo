package com.shepherdjerred.thestorm.creative.adapter.bundle;

import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotTemplate;
import java.io.IOException;
import java.io.UncheckedIOException;

/** Reads a plot table shipped in this jar. Callers run it off the server thread. */
public final class BundledTemplate {

  private BundledTemplate() {}

  public static PlotTemplate read(PlotGrid grid, String resource) {
    try (var in = BundledTemplate.class.getResourceAsStream(resource)) {
      if (in == null) {
        throw new IllegalStateException("creative template is missing: " + resource);
      }
      return PlotTemplate.decode(grid, in.readAllBytes());
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }
}
