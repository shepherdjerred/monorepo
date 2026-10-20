package com.shepherdjerred.thestorm.creative.domain;

/** What a block column is in the repeated plot square. */
public enum PlotColumn {
  /** The gap between plots. Players do not build here. */
  ROAD,
  /** The one-block ring around a plot's floor, included in the claim. */
  WALL,
  /** The grass square inside the wall. The 2016 builds are 80 by 80 here. */
  FLOOR
}
