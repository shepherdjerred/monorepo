package com.shepherdjerred.thestorm.shops.domain.catalog;

/**
 * A catalog and the file it came from.
 *
 * @param fileName the file's name, such as {@code baker.yml}
 * @param catalog its parsed contents
 */
public record CatalogFile(String fileName, Catalog catalog) {}
