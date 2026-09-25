/**
 * The economy's Paper glue: the first-join grant and the {@code /balance}, {@code /pay}, {@code
 * /baltop} and {@code /eco} commands. Everything here runs on the main thread and only waits for
 * the ledger through futures completed back onto it.
 */
@NullMarked
package com.shepherdjerred.thestorm.economy.adapter.paper;

import org.jspecify.annotations.NullMarked;
