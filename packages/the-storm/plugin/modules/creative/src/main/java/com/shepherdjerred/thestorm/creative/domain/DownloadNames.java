package com.shepherdjerred.thestorm.creative.domain;

/** File name for a one-plot schematic fetched outside the world. */
public final class DownloadNames {

  private DownloadNames() {}

  public static String file(PlotId id) {
    return id.x() + "_" + id.z() + ".schem";
  }
}
