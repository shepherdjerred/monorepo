package com.shepherdjerred.thestorm.rwfbots.app.map;

import java.util.Set;

/** Read-only, main-thread navigation cache inventory, without handing out graph references. */
public interface NavLoading {
  Set<String> decoded();
}
