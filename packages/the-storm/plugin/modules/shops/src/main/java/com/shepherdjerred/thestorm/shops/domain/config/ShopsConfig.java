package com.shepherdjerred.thestorm.shops.domain.config;

/**
 * The shops module's settings.
 *
 * @param chestShops sign shops on containers, and admin sign shops
 * @param catalogs the NPC shops
 */
public record ShopsConfig(ChestShopSettings chestShops, CatalogSettings catalogs) {}
