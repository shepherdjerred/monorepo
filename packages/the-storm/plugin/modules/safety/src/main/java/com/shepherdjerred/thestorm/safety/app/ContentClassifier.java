package com.shepherdjerred.thestorm.safety.app;

import com.shepherdjerred.thestorm.core.safety.ContentReview;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import java.util.concurrent.CompletableFuture;

/** The stateless moderation boundary, replaceable by a fixture in real-server tests. */
public interface ContentClassifier {
  CompletableFuture<ContentReview> classify(
      ContentSubmission submission, String text, String context);
}
