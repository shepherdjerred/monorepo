/**
 * The rwfbots use cases: the {@link com.shepherdjerred.thestorm.rwfbots.app.ThinkLoop} that runs
 * the pure think layers on the compute pool and trades immutable snapshots and decision boards with
 * the main thread, the {@link com.shepherdjerred.thestorm.rwfbots.app.Governor} that scales it
 * under load, the {@link com.shepherdjerred.thestorm.rwfbots.app.Director} that fills matches, and
 * the ports the adapters implement. Nothing here may touch Paper: it runs on worker threads.
 */
@NullMarked
package com.shepherdjerred.thestorm.rwfbots.app;

import org.jspecify.annotations.NullMarked;
