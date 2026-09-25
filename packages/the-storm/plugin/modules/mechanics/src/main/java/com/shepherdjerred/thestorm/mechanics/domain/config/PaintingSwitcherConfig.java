package com.shepherdjerred.thestorm.mechanics.domain.config;

/**
 * The painting switcher: right-clicking a painting shows the next picture of the same size.
 *
 * @param unlock who may use it
 */
public record PaintingSwitcherConfig(Unlock unlock) {}
