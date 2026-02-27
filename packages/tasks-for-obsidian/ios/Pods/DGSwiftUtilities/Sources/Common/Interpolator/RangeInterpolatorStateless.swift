//
//  RangeInterpolatorStateless.swift
//  
//
//  Created by Dominic Go on 7/20/24.
//

import Foundation


public struct RangeInterpolatorStateless<U: UniformInterpolatable>: RangeInterpolating {
  
  public typealias InterpolatableType = U;
  
  private(set) public var rangeInput: [CGFloat];
  private(set) public var rangeOutput: [InterpolatableValue];
  
  private(set) public var rangeInputMin: RangeItem;
  private(set) public var rangeInputMax: RangeItem;
  
  private(set) public var inputInterpolators: [InputInterpolator];
  private(set) public var inputExtrapolatorLeft: InputInterpolator;
  private(set) public var inputExtrapolatorRight: InputInterpolator;
  
  private(set) public var outputInterpolators: [OutputInterpolator];
  private(set) public var outputExtrapolatorLeft: OutputInterpolator;
  private(set) public var outputExtrapolatorRight: OutputInterpolator;
    
  public var targetBlock: TargetBlock?;
  
  // MARK: - Init
  // ------------
  
  public init(
    rangeInput: [CGFloat],
    rangeOutput: [InterpolatableValue],
    targetBlock: TargetBlock?,
    rangeInputMin: RangeItem,
    rangeInputMax: RangeItem,
    outputInterpolators: [OutputInterpolator],
    inputInterpolators: [InputInterpolator],
    inputExtrapolatorLeft: InputInterpolator,
    inputExtrapolatorRight: InputInterpolator,
    outputExtrapolatorLeft: OutputInterpolator,
    outputExtrapolatorRight: OutputInterpolator
  ) {
  
    self.rangeInput = rangeInput;
    self.rangeOutput = rangeOutput;
    self.targetBlock = targetBlock;
    self.rangeInputMin = rangeInputMin;
    self.rangeInputMax = rangeInputMax;
    self.outputInterpolators = outputInterpolators;
    self.inputInterpolators = inputInterpolators;
    self.inputExtrapolatorLeft = inputExtrapolatorLeft;
    self.inputExtrapolatorRight = inputExtrapolatorRight;
    self.outputExtrapolatorLeft = outputExtrapolatorLeft;
    self.outputExtrapolatorRight = outputExtrapolatorRight;
  };
};

