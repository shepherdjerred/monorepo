package com.shepherdjerred.thestorm.essentials.domain.place;

/**
 * A server-wide named destination set by staff.
 *
 * @param name the warp's name
 * @param position where it leads
 */
public record Warp(PlaceName name, Position position) {}
