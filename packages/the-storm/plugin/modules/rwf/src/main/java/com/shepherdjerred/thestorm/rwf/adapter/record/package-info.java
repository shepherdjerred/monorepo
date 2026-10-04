/**
 * Match recordings on disk: newline-delimited {@code RecordCodec} rows, gzipped, written off the
 * main thread on core's compute pool, and pruned by age and size at enable.
 */
@NullMarked
package com.shepherdjerred.thestorm.rwf.adapter.record;

import org.jspecify.annotations.NullMarked;
