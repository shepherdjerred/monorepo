/**
 * The only rwfbots package that may touch Citizens ({@code net.citizensnpcs.api} and {@code
 * net.citizensnpcs.trait}; architecture tests enforce it). Citizens is a runtime plugin pinned in
 * {@code server/plugins.json}, compiled against as {@code compileOnly}, and loaded on TheStorm's
 * classpath through {@code paper-plugin.yml}. Like {@code adapter.paper}, this package runs on the
 * main thread and never blocks.
 */
@NullMarked
package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import org.jspecify.annotations.NullMarked;
