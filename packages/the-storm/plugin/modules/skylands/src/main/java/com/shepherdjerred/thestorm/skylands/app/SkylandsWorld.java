package com.shepherdjerred.thestorm.skylands.app;

/**
 * Published once the skylands world is created or loaded with its generator, before any later
 * module enables. Other modules {@code require} it to treat the world as a declared generated
 * world, which also fails their startup if the skylands module is disabled or ordered after them.
 *
 * @param name the loaded world's name
 */
public record SkylandsWorld(String name) {}
