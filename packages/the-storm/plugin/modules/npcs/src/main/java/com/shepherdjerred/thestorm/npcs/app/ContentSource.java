package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.npcs.domain.content.Content;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentProblem;
import java.util.List;

/** Reads and validates the NPC content files. File I/O: never on the main thread. */
@FunctionalInterface
public interface ContentSource {

  Result<Content, List<ContentProblem>> load();
}
