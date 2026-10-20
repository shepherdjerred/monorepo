/**
 * Pauses movement and breaking checks while a player is in the creative world. Grim's owned config
 * has no per-world exemption, so this uses the check API and restores the previous state on leave.
 */
@NullMarked
package com.shepherdjerred.thestorm.creative.adapter.grim;

import org.jspecify.annotations.NullMarked;
