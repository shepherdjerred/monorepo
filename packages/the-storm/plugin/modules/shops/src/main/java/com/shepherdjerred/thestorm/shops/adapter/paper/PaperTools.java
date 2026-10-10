package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;

/**
 * The Paper helpers several listeners share.
 *
 * @param blocks where shops are in the world
 * @param templates item fingerprints
 * @param replies messages and main-thread completion
 */
record PaperTools(
    ShopBlocks blocks, ItemTemplates templates, Replies replies, ProductAnalytics analytics) {}
