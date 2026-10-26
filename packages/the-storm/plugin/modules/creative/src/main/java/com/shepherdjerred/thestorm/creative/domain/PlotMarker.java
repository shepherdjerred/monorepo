package com.shepherdjerred.thestorm.creative.domain;

/**
 * One plot drawn on the creative map. Coordinates are the plot footprint, wall included.
 *
 * @param label the plot's name, or the owner's username when the plot has no name
 */
public record PlotMarker(PlotId id, String label, int minX, int maxX, int minZ, int maxZ) {}
