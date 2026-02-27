//
//  InLineDisplayLink.swift
//  
//
//  Created by Dominic Go on 12/27/24.
//

import Foundation
import QuartzCore


public class InLineDisplayLink {

  public typealias Context = (
    sender: InLineDisplayLink,
    displayLink: CADisplayLink
  );

  public typealias UpdateBlock = (_ context: Context) -> Void;
  
  // MARK: - Properties
  // ------------------
  
  public var runloop: RunLoop;
  public var runloopMode: RunLoop.Mode;
  
  private weak var displayLinkTarget: DisplayLinkTarget?;
  public private(set) var displayLink: CADisplayLink;

  public private(set) var delegates: MulticastDelegate<InLineDisplayLinkDelegate> = .init();
  
  public var updateBlock: UpdateBlock?;
  public var startBlock: UpdateBlock?;
  public var endBlock: UpdateBlock?;
  
  private var pendingRestart = false;
  
  public fileprivate(set) var isRunning: Bool = false;
  public fileprivate(set) var isExplicitlyPaused: Bool = false;
  
  public fileprivate(set) var timestampStart: CFTimeInterval?;
  public fileprivate(set) var timestampFirstFrame: CFTimeInterval?;
  
  public fileprivate(set) var timestampPrevFrame: CFTimeInterval?;
  public fileprivate(set) var timestampLastFrame: CFTimeInterval?;
  
  public fileprivate(set) var frameCounter = 0;
  public fileprivate(set) var elapsedTime: TimeInterval = 0;
  public fileprivate(set) var frameDuration: TimeInterval = 0;
  
  public var shouldPauseUntilUpdateFinishes: Bool = false;
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var frameTimestampDelta: TimeInterval {
    guard let timestampLastFrame = self.timestampLastFrame,
          let timestampPrevFrame = self.timestampPrevFrame
    else {
      return 0;
    };
    
    return timestampLastFrame - timestampPrevFrame;
  };
  
  public var isPaused: Bool {
    self.displayLink.isPaused || self.isExplicitlyPaused;
  };
  
  // MARK: - Init
  // ------------
  
  public init(
    withRunloop runloop: RunLoop = .main,
    runLoopMode: RunLoop.Mode = .common,
    shouldRetain: Bool = false,
    shouldImmediatelyStart: Bool = true,
    delegates initialDelegates: [InLineDisplayLinkDelegate] = []
  ) {
  
    self.runloop = runloop;
    self.runloopMode = runLoopMode;
  
    let target = DisplayLinkTarget(shouldRetainParent: shouldRetain);
    self.displayLinkTarget = target;
  
    let displayLink = CADisplayLink(
      target: target,
      selector: #selector(DisplayLinkTarget._updateBlock(_:))
    );
    
    self.displayLink = displayLink;
    target.parent = self;
    
    initialDelegates.forEach {
      self.delegates.add($0);
    };
    
    if shouldImmediatelyStart {
      self.startIfNeeded();
    };
  };
  
  public convenience init(
    withRunloop runloop: RunLoop = .main,
    runLoopMode: RunLoop.Mode = .common,
    shouldRetain: Bool = false,
    shouldImmediatelyStart: Bool = true,
    updateBlock: @escaping UpdateBlock,
    startBlock: Optional<UpdateBlock> = nil,
    endBlock: Optional<UpdateBlock> = nil
  ) {
  
    self.init(
      withRunloop: runloop,
      runLoopMode: runLoopMode,
      shouldRetain: shouldRetain,
      shouldImmediatelyStart: false,
      delegates: []
    );
    
    self.updateBlock = updateBlock;
    self.startBlock = startBlock;
    self.endBlock = endBlock;
    
    if shouldImmediatelyStart {
      self.startIfNeeded();
    };
  };
  
  deinit {
    self.stop();
  };
  
  public func startIfNeeded(){
    guard !self.isRunning else {
      return;
    };
    
    self.isExplicitlyPaused = false;
    self.displayLink.isPaused = false;
    
    let didRestart = self.pendingRestart;
    self.pendingRestart = false;
    
    if self.timestampStart == nil {
      self.timestampStart = CACurrentMediaTime();
    };
    
    self.displayLink.add(
      to: self.runloop,
      forMode: self.runloopMode
    );
    
    self.isRunning = true;
    self.startBlock?((self, displayLink));
    
    self.delegates.invoke {
      $0.notifyOnDisplayLinkStarted(
        sender: self,
        displayLink: self.displayLink,
        didRestart: didRestart
      );
    };
  };
  
  public func stop(){
    self.isRunning = false;
    self.displayLink.invalidate();
    self.endBlock?((self, self.displayLink));
  };
  
  public func resetAndRestart(){
    self.stop();
    
    self.timestampStart = nil;
    self.timestampFirstFrame = nil;
    self.timestampPrevFrame = nil;
    self.timestampLastFrame = nil;
    
    self.frameCounter = 0;
    self.elapsedTime = 0;
    self.frameDuration = 0;
    
    self.pendingRestart = true;
    self.startIfNeeded();
  };
  
  public func pause() {
    self.isExplicitlyPaused = true;
    self.displayLink.isPaused = true;
    
    self.delegates.invoke {
      $0.notifyOnDisplayLinkPaused(
        sender: self,
        displayLink: self.displayLink
      );
    };
  };
  
  public func resume() {
    self.isExplicitlyPaused = false;
    self.displayLink.isPaused = false;
    
    self.delegates.invoke {
      $0.notifyOnDisplayLinkStarted(
        sender: self,
        displayLink: self.displayLink
      );
    };
  };
}

// MARK: - DisplayLinkTarget
// -------------------------

/// Retained by CADisplayLink.
fileprivate class DisplayLinkTarget {
  
  weak var _parentWeak: InLineDisplayLink?;
  var _parentStrong: InLineDisplayLink?;
  
  var shouldRetainParent: Bool;
  var parent: InLineDisplayLink? {
    set {
      if self.shouldRetainParent {
        self._parentStrong = newValue;
        
      } else {
        self._parentWeak = newValue
      };
    }
    get {
      self._parentWeak ?? self._parentStrong;
    }
  };
  
  init(
    parent: InLineDisplayLink? = nil,
    shouldRetainParent: Bool
  ) {
    self.shouldRetainParent = shouldRetainParent;
    self.parent = parent;
  };
  
  @objc func _updateBlock(_ sender: CADisplayLink) {
    guard let parent = self.parent else {
      return;
    };
    
    if !parent.isRunning {
      parent.isRunning = false;
    };
    
    if parent.timestampFirstFrame == nil {
      parent.timestampFirstFrame = sender.timestamp;
    };
    
    let prevFrame = parent.timestampLastFrame;
    parent.timestampPrevFrame = prevFrame;
    
    parent.frameCounter += 1;
    parent.timestampLastFrame = sender.timestamp;
    
    let elapsedTime = sender.timestamp - parent.timestampFirstFrame!;
    parent.elapsedTime = elapsedTime;
    
    let frameDuration = sender.targetTimestamp - sender.timestamp;
    parent.frameDuration = frameDuration;
    
    // temp. pause timer
    if parent.shouldPauseUntilUpdateFinishes {
      sender.isPaused = true;
    };
    
    parent.updateBlock?((
      sender: parent,
      displayLink: sender
    ));
    
    parent.delegates.invoke {
      $0.notifyOnDisplayLinkTick(
        sender: parent,
        displayLink: sender
      );
    };
    
    // undo temp. pause (if not paused externally)
    if parent.shouldPauseUntilUpdateFinishes,
      !parent.isExplicitlyPaused
    {
      sender.isPaused = false;
    };
  };
};
