/**
 * The Paper side of Search and Destroy: the match runner that carries out the rules' effects, the
 * listeners that turn server events into match events and enforce Red Warfare combat inside the
 * sealed world, the map paster and verifier, bomb markers, scoreboards and commands. Main thread
 * only: no I/O, no blocking.
 */
@NullMarked
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import org.jspecify.annotations.NullMarked;
