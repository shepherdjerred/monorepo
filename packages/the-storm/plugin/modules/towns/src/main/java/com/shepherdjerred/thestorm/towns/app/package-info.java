/**
 * The towns module's use cases and in-memory state. All state lives in memory, loaded once at
 * enable and changed on the main thread; storage writes happen behind it and roll the memory back
 * if they fail.
 */
@NullMarked
package com.shepherdjerred.thestorm.towns.app;

import org.jspecify.annotations.NullMarked;
