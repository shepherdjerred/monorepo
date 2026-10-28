/**
 * The land-protection ports. The towns module provides the implementations; every other module asks
 * {@link com.shepherdjerred.thestorm.core.protection.Protection} before changing the world, and
 * {@link com.shepherdjerred.thestorm.core.protection.SettledLand} when it needs to stay away from
 * claims. Shops publishes {@link com.shepherdjerred.thestorm.core.protection.ReservedContainers}
 * for containers a shop already claims.
 */
@NullMarked
package com.shepherdjerred.thestorm.core.protection;

import org.jspecify.annotations.NullMarked;
