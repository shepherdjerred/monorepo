package com.shepherdjerred.thestorm.creative.domain;

/**
 * One plot drawn on the creative map. Coordinates are the plot footprint, wall included.
 *
 * @param label id, owner, name, and description
 */
public record PlotMarker(PlotId id, String label, int minX, int maxX, int minZ, int maxZ) {}
