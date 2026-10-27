package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import java.time.Duration;
import java.util.function.BooleanSupplier;

/** Shared lifetime and rollout settings for both kinds of gate. */
record StargateSettings(Duration openFor, BooleanSupplier enabled) {}
