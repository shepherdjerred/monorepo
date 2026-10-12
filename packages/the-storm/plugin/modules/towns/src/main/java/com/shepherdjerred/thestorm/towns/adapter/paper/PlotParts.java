package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.towns.app.LockBook;
import com.shepherdjerred.thestorm.towns.app.LocksStore;
import com.shepherdjerred.thestorm.towns.app.ParcelBook;
import com.shepherdjerred.thestorm.towns.app.RecoveryStore;
import com.shepherdjerred.thestorm.towns.app.TownsState;
import java.util.Map;
import java.util.concurrent.Executor;

/** Main-thread runtime and detached archive executor shared by finite plot operations. */
record PlotParts(
    ModuleContext context,
    TownsState state,
    ParcelBook parcels,
    com.shepherdjerred.thestorm.towns.app.PlotRentals rentals,
    com.shepherdjerred.thestorm.towns.app.LockService lockService,
    LockBook locks,
    LocksStore lockStore,
    RecoveryStore recoveries,
    Map<String, RecoveryStore.Baseline> baselines,
    com.shepherdjerred.thestorm.towns.domain.parcel.PlotProtocol protocol,
    Executor archives,
    PlotWorld world) {}
