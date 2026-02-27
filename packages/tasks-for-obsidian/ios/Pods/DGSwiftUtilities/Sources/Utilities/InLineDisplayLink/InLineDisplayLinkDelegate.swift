//
//  InLineDisplayLinkDelegate.swift
//  
//
//  Created by Dominic Go on 12/27/24.
//

import Foundation
import QuartzCore


public protocol InLineDisplayLinkDelegate: AnyObject {
  
  func notifyOnDisplayLinkTick(
    sender: InLineDisplayLink,
    displayLink: CADisplayLink
  );
  
  func notifyOnDisplayLinkStarted(
    sender: InLineDisplayLink,
    displayLink: CADisplayLink,
    didRestart: Bool
  );
  
  func notifyOnDisplayLinkStopped(
    sender: InLineDisplayLink,
    displayLink: CADisplayLink
  );
  
  func notifyOnDisplayLinkPaused(
    sender: InLineDisplayLink,
    displayLink: CADisplayLink
  );
  
  func notifyOnDisplayLinkResumed(
    sender: InLineDisplayLink,
    displayLink: CADisplayLink
  );
};

// MARK: - InLineDisplayLinkDelegate+Default
// -----------------------------------------

public extension InLineDisplayLinkDelegate {
  
  func notifyOnDisplayLinkTick(
    sender: InLineDisplayLink,
    displayLink: CADisplayLink
  ) {
    // no-op
  };
  
  func notifyOnDisplayLinkStarted(
    sender: InLineDisplayLink,
    displayLink: CADisplayLink
  ) {
    // no-op
  };
  
  func notifyOnDisplayLinkStopped(
    sender: InLineDisplayLink,
    displayLink: CADisplayLink
  ) {
    // no-op
  };
  
  func notifyOnDisplayLinkPaused(
    sender: InLineDisplayLink,
    displayLink: CADisplayLink
  ) {
    // no-op
  };
  
  func notifyOnDisplayLinkResumed(
    sender: InLineDisplayLink,
    displayLink: CADisplayLink
  ) {
    // no-op
  };
};
