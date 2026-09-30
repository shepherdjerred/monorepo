package com.shepherdjerred.thestorm.mechanics.domain.config;

/**
 * Hidden switches: an {@code [X]} sign on the far side of a wall; right-clicking the wall flips the
 * levers and presses the buttons beside the sign.
 *
 * @param access who may build and use them
 */
public record HiddenSwitchConfig(Access access) {}
