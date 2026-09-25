/**
 * The towns module's Paper glue: the protection listeners, the {@code Protection} port, and the
 * {@code /town}, {@code /claim}, {@code /unclaim} and {@code /region} commands. Listeners only
 * translate Paper events into the domain's acts and world effects and apply the answer; the rules
 * live in the domain. Everything here runs on the main thread and never waits on storage.
 */
@NullMarked
package com.shepherdjerred.thestorm.towns.adapter.paper;

import org.jspecify.annotations.NullMarked;
