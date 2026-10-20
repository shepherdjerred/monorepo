package com.shepherdjerred.thestorm.creative.domain;

import java.util.Optional;
import java.util.UUID;

/**
 * A claim attempt. {@code countedClaims} excludes restored catalog plots. Staff skip the cap and
 * still cannot take a staff-held or owned plot.
 */
public record ClaimRequest(
    UUID actor,
    boolean staff,
    boolean insideBorder,
    Optional<PlotId> standing,
    PlotView view,
    int countedClaims,
    int cap) {}
