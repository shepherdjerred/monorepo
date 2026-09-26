package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.app.GraveRegistry;
import com.shepherdjerred.thestorm.qol.app.store.GraveStore;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePolicy;

/**
 * What the grave adapters share.
 *
 * @param store grave storage
 * @param registry the graves in memory
 * @param placement where a new grave may go
 * @param policy who may open a grave when, and when it expires
 * @param face the face grave heads wear
 */
record GraveParts(
    GraveStore store,
    GraveRegistry registry,
    GravePlacement placement,
    GravePolicy policy,
    GraveFace face) {}
