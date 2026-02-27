//
//  RepeatedExecution.swift
//  DGSwiftUtilities
//
//  Created by Dominic Go on 7/26/25.
//

import Foundation
import QuartzCore


public class RepeatedExecution {
  
  // MARK: - Embedded Types
  
  public enum ExecutionState: String {
    case idle;
    case running;
    case endedSuccessfully;
    case endedPrematurely;
    
    var isRunning: Bool {
      switch self {
        case .running:
          return true;
          
        default:
          return false;
      };
    };
  };
  
  public enum ExecutionLimit {
    case maxIterations(Int);
    case maxTimeInterval(TimeInterval);
    case customCondition((_ context: RepeatedExecution) -> Bool);
    case noLimit;
  };

  public enum ExecutionDebounce {
    case minTimeInterval(TimeInterval);
    case frameRate(Int);
  };
  
  public typealias ExecutionBlock = (_ context: RepeatedExecution) -> Void;
  
  public typealias ExecutionEndConditionBlock = (_ context: RepeatedExecution) -> Bool;
  
  // MARK: - Properties
  // ------------------
  
  public let limiterMode: ExecutionLimit;
  public let debounceMode: ExecutionDebounce;
  
  public let executeBlock: ExecutionBlock;
  public let executionEndConditionBlock: ExecutionEndConditionBlock?;

  private(set) public var state: ExecutionState = .idle;
  private(set) public var iterationCount = 0;
  
  private(set) public var timestampStart: TimeInterval = 0;
  private(set) public var timestampLastExecution: TimeInterval = 0;
  private(set) public var timestampTotalExecutionDuration: TimeInterval = 0;
  
  public let shouldRetainByDisplayLink: Bool;
  private(set) public var displayLink: CADisplayLink?;
  
  // MARK: - Init
  // ------------

  public init(
    limit: ExecutionLimit,
    debounce: ExecutionDebounce,
    shouldRetainByDisplayLink: Bool = true,
    executeBlock: @escaping ExecutionBlock,
    executionEndConditionBlock: ExecutionEndConditionBlock? = nil
  ) {
    self.limiterMode = limit;
    self.debounceMode = debounce;
    self.executeBlock = executeBlock;
    self.executionEndConditionBlock = executionEndConditionBlock;
    self.shouldRetainByDisplayLink = shouldRetainByDisplayLink;
  };
  
  // MARK: - Public Methods
  // ----------------------

  public func start() {
    guard state == .idle else {
      return;
    };
    
    self.state = .running;
    self.timestampStart = CACurrentMediaTime();
    self.timestampLastExecution = timestampStart;
    self.iterationCount = 0;

    switch debounceMode {
      case let .frameRate(frameRate):
        let displayLink: CADisplayLink = {
          if self.shouldRetainByDisplayLink {
            return CADisplayLink(
              target: self,
              selector: #selector(Self.step)
            );
          };
          
          let proxy = SelectorProxy<RepeatedExecution>(target: self) {
            $0.target.step();
          };
          
          let displayLink = CADisplayLink(
            target: proxy,
            selector: #selector(SelectorProxy<RepeatedExecution>.invokeBlock)
          );
          
          return displayLink;
        }();
        
        displayLink.preferredFramesPerSecond = frameRate;
        self.displayLink = displayLink;
        
      case .minTimeInterval(_):
        self.step();
        break;
    };
    
    if let displayLink = self.displayLink {
      displayLink.add(to: .main, forMode: .common);
    };
  };

  public func end(successfully: Bool = false) {
    self.clearDisplayLink();
    
    self.state = successfully
      ? .endedSuccessfully
      : .endedPrematurely;
  };
  
  // MARK: - Private Methods
  // ----------------------
  
  private func clearDisplayLink() {
    guard let displayLink = self.displayLink else {
      return;
    };
    
    displayLink.invalidate();
    self.displayLink = nil;
  };

  @objc private func step() {
    guard state.isRunning else {
      return;
    }

    let timestampCurrent = CACurrentMediaTime();
    let timestampElapsed = timestampCurrent - self.timestampStart;
    
    self.timestampTotalExecutionDuration = timestampElapsed;
    self.timestampLastExecution = timestampCurrent;
    
    self.iterationCount += 1;
    self.executeBlock(self);
    
    let shouldEnd = executionEndConditionBlock?(self) ?? false;
    if shouldEnd {
      self.end(successfully: true);
      return;
    };
    
    switch limiterMode {
      case let .maxIterations(max) where iterationCount >= max:
        self.end(successfully: false);
        
      case let .maxTimeInterval(max) where timestampCurrent - timestampStart >= max:
        self.end(successfully: false);
        
      case let .customCondition(condition) where condition(self):
        self.end(successfully: false);
        
      default:
        break;
    };
    
    switch debounceMode {
      case let .minTimeInterval(minTimeInterval):
        DispatchQueue.main.asyncAfter(deadline: .now() + minTimeInterval) {
          self.step();
        };
        
      default:
        break;
    };
  }
}
