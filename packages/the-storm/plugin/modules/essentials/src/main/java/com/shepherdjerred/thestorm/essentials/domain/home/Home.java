package com.shepherdjerred.thestorm.essentials.domain.home;

import com.shepherdjerred.thestorm.essentials.domain.place.PlaceName;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;

/**
 * A player's named home.
 *
 * @param name the home's name, unique per player
 * @param position where it is
 */
public record Home(PlaceName name, Position position) {}
