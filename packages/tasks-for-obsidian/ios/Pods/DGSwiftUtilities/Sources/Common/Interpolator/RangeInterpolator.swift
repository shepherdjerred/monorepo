//
//  RangeInterpolator.swift
//  
//
//  Created by Dominic Go on 7/10/24.
//

import Foundation


public struct RangeInterpolator<U: UniformInterpolatable>: RangeInterpolating, RangeInterpolatorStateTracking {

  public typealias InterpolatableType = U;
  
  public var rangeInput: [CGFloat];
  public var rangeOutput: [U.InterpolatableValue];
  
  public var rangeInputMin: RangeItem;
  public var rangeInputMax: RangeItem;
  
  private(set) public var inputInterpolators: [InputInterpolator];
  private(set) public var inputExtrapolatorLeft: InputInterpolator;
  private(set) public var inputExtrapolatorRight: InputInterpolator;
  
  private(set) public var outputInterpolators: [OutputInterpolator];
  private(set) public var outputExtrapolatorLeft: OutputInterpolator;
  private(set) public var outputExtrapolatorRight: OutputInterpolator;
    
  public var targetBlock: TargetBlock?;
  
  public var inputValuePrev: CGFloat?
  public var inputValueCurrent: CGFloat?
  
  public var outputValuePrev: InterpolatableValue?
  public var outputValueCurrent: InterpolatableValue?
  
  public var interpolationModePrevious: RangeInterpolationMode?
  public var interpolationModeCurrent: RangeInterpolationMode?
  
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
