package com.shepherdjerred.thestorm.mechanics.domain.config;

import java.util.List;
import java.util.Set;

/**
 * Light switches: a {@code [|]} sign that turns nearby lights on or off.
 *
 * @param access who may build and use them
 * @param radius how far from the sign, in every direction, lights are switched
 * @param maxLights the most lights one sign switches, nearest first
 * @param lights the light materials it switches; each must have an on/off ({@code lit}) state
 */
public record LightSwitchConfig(Access access, int radius, int maxLights, List<String> lights) {

  public static final int MAX_RADIUS = 16;
  public static final int MAX_LIGHTS = 128;

  public LightSwitchConfig {
    Checks.range("radius", radius, 1, MAX_RADIUS);
    Checks.range("maxLights", maxLights, 1, MAX_LIGHTS);
    lights = List.copyOf(Checks.materials("lights", lights));
  }

  public Set<String> allowed() {
    return Set.copyOf(lights);
  }
}
