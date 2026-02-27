//
//  RangeInterpolating.swift
//  
//
//  Created by Dominic Go on 7/20/24.
//

import Foundation


public protocol RangeInterpolating: AnyRangeInterpolating {

  associatedtype InterpolatableType: UniformInterpolatable;
  typealias InterpolatableValue = InterpolatableType.InterpolatableValue;
  
  // MARK: - Embedded Types
  // ----------------------

  typealias RangeItemOutput =
    IndexValuePair<InterpolatableType.InterpolatableValue>;
    
  typealias OutputInterpolator =
    DGSwiftUtilities.Interpolator<InterpolatableType>;
  
  typealias TargetBlock = (
    _ sender: Self,
    _ interpolatedValue: InterpolatableValue
  ) -> Void;
  
  typealias EasingProvider = CompositeInterpolatableMappingProvider<
    InterpolatableValue,
    InterpolationEasing?
  >;
  
  typealias EasingMapProvider = CompositeInterpolatableMappingProvider<
    InterpolatableValue,
    CompositeInterpolatable.EasingKeyPathMap?
  >;
  
  typealias ClampingMapProvider = CompositeInterpolatableMappingProvider<
    InterpolatableValue,
    CompositeInterpolatable.ClampingKeyPathMap?
  >;
  
  typealias EasingElementMapProvider<
    T: ElementInterpolatable
  > = CompositeInterpolatableMappingProvider<
    InterpolatableValue,
    T.EasingElementMap?
  >;
  
  typealias ClampingElementMapProvider<
    T: ElementInterpolatable
  > = CompositeInterpolatableMappingProvider<
    InterpolatableValue,
    T.ClampingElementMap?
  >;
  
  // MARK: - Property Requirements
  // -----------------------------

  var rangeOutput: [InterpolatableValue] { get };

  var outputInterpolators: [OutputInterpolator] { get };
  var outputExtrapolatorLeft : OutputInterpolator { get };
  var outputExtrapolatorRight: OutputInterpolator { get };
  
  var targetBlock: TargetBlock? { get };
  
  // MARK: - Init Requirements
  // -------------------------
  
  init(
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
  );
};

// MARK: - RangeInterpolating+Helpers
// ----------------------------------

public extension RangeInterpolating {
  
  var isTargetBlockSet: Bool {
    self.targetBlock != nil;
  };
  
  // MARK: - Init
  // ------------
  
  /// Shared internal init
  internal init(
    rangeInput: [CGFloat],
    rangeOutput: [InterpolatableValue],
    targetBlock: TargetBlock?,
    outputInterpolators: [OutputInterpolator],
    outputExtrapolatorLeft: OutputInterpolator,
    outputExtrapolatorRight: OutputInterpolator
  ) {
  
    let rangeInputMin = rangeInput.indexedMin!;
    let rangeInputMax = rangeInput.indexedMax!;
    
    var inputInterpolators: [InputInterpolator] = [];
    
    for index in 0..<rangeInput.count - 1 {
      let isFirstIndex = index == 0;
      let isLastIndex  = index == rangeInput.count - 1;
      
      let inputStart: CGFloat = isFirstIndex
        ? 0
        : CGFloat(index) + 1 / CGFloat(rangeInput.count);
        
      let inputEnd: CGFloat = isLastIndex
        ? 1
        : CGFloat(index) + 2 / CGFloat(rangeInput.count);
      
      let inputInterpolator: InputInterpolator = .init(
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: rangeInput[index],
        outputValueEnd: rangeInput[index + 1]
      );
      
      inputInterpolators.append(inputInterpolator);
    };

    let inputExtrapolatorLeft = Self.createInputExtrapolatorLeft(
      rangeInput: rangeInput,
      inputInterpolators: inputInterpolators,
      clampingOptions: .none
    );
    
    let inputExtrapolatorRight = Self.createInputExtrapolatorRight(
      rangeInput: rangeInput,
      inputInterpolators: inputInterpolators,
      clampingOptions: .none
    );
    
    self.init(
      rangeInput: rangeInput,
      rangeOutput: rangeOutput,
      targetBlock: targetBlock,
      rangeInputMin: rangeInputMin,
      rangeInputMax: rangeInputMax,
      outputInterpolators: outputInterpolators,
      inputInterpolators: inputInterpolators,
      inputExtrapolatorLeft: inputExtrapolatorLeft,
      inputExtrapolatorRight: inputExtrapolatorRight,
      outputExtrapolatorLeft: outputExtrapolatorLeft,
      outputExtrapolatorRight: outputExtrapolatorRight
    );
  };
  

  init(
    rangeInput: [CGFloat],
    rangeOutput: [InterpolatableValue],
    easingProvider: EasingProvider?,
    clampingOptions: ClampingOptions = .none,
    targetBlock: TargetBlock? = nil
  ) throws {
      
    try Self.checkIfValid(
      rangeInput: rangeInput,
      rangeOutput: rangeOutput
    );
    
    var outputInterpolators: [OutputInterpolator] = [];
    
    for index in 0..<rangeInput.count - 1 {
      let inputStart = rangeInput[index];
      let inputEnd   = rangeInput[index + 1];
      
      let outputStart = rangeOutput[index];
      let outputEnd   = rangeOutput[index + 1];
      
      let easing = easingProvider?.invoke(
        rangeIndex: index,
        interpolatorType: .interpolate(interpolatorIndex: index),
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd
      );
      
      let outputInterpolator: OutputInterpolator = .init(
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd,
        easing: easing
      );
      
      outputInterpolators.append(outputInterpolator);
    };
        
    let outputExtrapolatorLeft: OutputInterpolator = {
      let inputStart  = rangeInput [1];
      let inputEnd    = rangeInput [0];
      let outputStart = rangeOutput[1];
      let outputEnd   = rangeOutput[0];
    
      let easing = easingProvider?.invoke(
        rangeIndex: -1,
        interpolatorType: .extrapolateLeft,
        inputValueStart: inputEnd,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd
      );
      
      return .init(
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd,
        easing: easing,
        clampingOptions: clampingOptions.shouldClampLeft ? .left : .none
      );
    }();
    
    let outputExtrapolatorRight: OutputInterpolator = {
      let inputStart  = rangeInput.secondToLast!;
      let inputEnd    = rangeInput.last!;
      let outputStart = rangeOutput.secondToLast!;
      let outputEnd   = rangeOutput.last!;
      
      let easing = easingProvider?.invoke(
        rangeIndex: rangeInput.count,
        interpolatorType: .extrapolateRight,
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd
      );
      
      return .init(
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd,
        easing: easing,
        clampingOptions: clampingOptions.shouldClampRight ? .right : .none
      );
    }();
    
    self.init(
      rangeInput: rangeInput,
      rangeOutput: rangeOutput,
      targetBlock: targetBlock,
      outputInterpolators: outputInterpolators,
      outputExtrapolatorLeft: outputExtrapolatorLeft,
      outputExtrapolatorRight: outputExtrapolatorRight
    );
  };
  
  init(
    rangeInput: [CGFloat],
    rangeOutput: [InterpolatableValue],
    easingMapProvider: EasingMapProvider?,
    clampingMapProvider: ClampingMapProvider?,
    targetBlock: TargetBlock? = nil
  ) throws where InterpolatableType: CompositeInterpolatable {
    
    try Self.checkIfValid(
      rangeInput: rangeInput,
      rangeOutput: rangeOutput
    );
    
    var outputInterpolators: [OutputInterpolator] = [];
    
    for index in 0..<rangeInput.count - 1 {
      let inputStart = rangeInput[index];
      let inputEnd   = rangeInput[index + 1];
      
      let outputStart = rangeOutput[index];
      let outputEnd   = rangeOutput[index + 1];
      
      let easingMap = easingMapProvider?.invoke(
        rangeIndex: index,
        interpolatorType: .interpolate(interpolatorIndex: index),
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd
      );
      

      let outputInterpolator: OutputInterpolator = .init(
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd,
        easingMap: easingMap ?? [:],
        clampingMap: [:]
      );
      
      outputInterpolators.append(outputInterpolator);
    };
    
    let outputExtrapolatorLeft: OutputInterpolator = {
      let inputStart  = rangeInput [1];
      let inputEnd    = rangeInput [0];
      let outputStart = rangeOutput[1];
      let outputEnd   = rangeOutput[0];
      
      let easingMap = easingMapProvider?.invoke(
        rangeIndex: -1,
        interpolatorType: .extrapolateLeft,
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd
      );
      
      let clampingMap = clampingMapProvider?.invoke(
        rangeIndex: -1,
        interpolatorType: .extrapolateLeft,
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd
      );
      
      let clampingMapAdj = clampingMap?.mapValues {
        $0.shouldClampLeft ? ClampingOptions.left : .none;
      };
      
      return .init(
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd,
        easingMap: easingMap ?? [:],
        clampingMap: clampingMapAdj ?? [:]
      );
    }();
    
    let outputExtrapolatorRight: OutputInterpolator = {
      let inputStart  = rangeInput.secondToLast!;
      let inputEnd    = rangeInput.last!;
      let outputStart = rangeOutput.secondToLast!;
      let outputEnd   = rangeOutput.last!;
      
      let easingMap = easingMapProvider?.invoke(
        rangeIndex: rangeInput.count,
        interpolatorType: .extrapolateRight,
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd
      );
      
      let clampingMap = clampingMapProvider?.invoke(
        rangeIndex: rangeInput.count,
        interpolatorType: .extrapolateRight,
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd
      );
      
      let clampingMapAdj = clampingMap?.mapValues {
        $0.shouldClampRight ? ClampingOptions.right : .none;
      };
      
      return .init(
        inputValueStart: inputStart,
        inputValueEnd: inputEnd,
        outputValueStart: outputStart,
        outputValueEnd: outputEnd,
        easingMap: easingMap ?? [:],
        clampingMap: clampingMapAdj ?? [:]
      );
    }();
    
    self.init(
      rangeInput: rangeInput,
      rangeOutput: rangeOutput,
      targetBlock: targetBlock,
      outputInterpolators: outputInterpolators,
      outputExtrapolatorLeft: outputExtrapolatorLeft,
      outputExtrapolatorRight: outputExtrapolatorRight
    );
  };
  
  init(
    rangeInput: [CGFloat],
    rangeOutput: [InterpolatableValue],
    easingElementMapProvider: EasingElementMapProvider<InterpolatableValue>?,
    clampingElementMapProvider: ClampingElementMapProvider<InterpolatableValue>?,
    targetBlock: TargetBlock? = nil
  ) throws where InterpolatableType: ElementInterpolatable {
  
    var easingMapProvider: EasingMapProvider?;
    var clampingMapProvider: ClampingMapProvider?;

    if let easingElementMapProvider = easingElementMapProvider {
      easingMapProvider = .verbose {
        let easingElementMap = easingElementMapProvider.invoke(
          rangeIndex      : $0,
          interpolatorType: $1,
          inputValueStart : $2,
          inputValueEnd   : $3,
          outputValueStart: $4,
          outputValueEnd  : $5
        );
        
        return .init(
          type: InterpolatableValue.self,
          easingElementMap: easingElementMap ?? [:]
        );
      };
    };
    
    if let clampingElementMapProvider = clampingElementMapProvider {
      clampingMapProvider = .verbose {
        let clampingElementMap = clampingElementMapProvider.invoke(
          rangeIndex      : $0,
          interpolatorType: $1,
          inputValueStart : $2,
          inputValueEnd   : $3,
          outputValueStart: $4,
          outputValueEnd  : $5
        );
        
        return .init(
          type: InterpolatableValue.self,
          clampingElementMap: clampingElementMap ?? [:]
        );
      };
    };
    
    try self.init(
      rangeInput: rangeInput,
      rangeOutput: rangeOutput,
      easingMapProvider: easingMapProvider,
      clampingMapProvider: clampingMapProvider,
      targetBlock: targetBlock
    );
  };
  
  // MARK: - Functions
  // -----------------
  
  func createDirectInterpolator(
    fromStartIndex startIndex: Int,
    toEndIndex endIndex: Int,
    shouldEmbedTargetBlock: Bool = true
  ) throws -> OutputInterpolator {
  
    try self.checkIfValid(
      rangeStartIndex: startIndex,
      rangeEndIndex: endIndex
    );
    
    let inputStart = rangeInput[startIndex];
    let inputEnd   = rangeInput[startIndex];
    
    let outputStart = rangeOutput[endIndex];
    let outputEnd   = rangeOutput[endIndex];
    
    var interpolator: OutputInterpolator = .init(
      inputValueStart : inputStart ,
      inputValueEnd   : inputEnd   ,
      outputValueStart: outputStart,
      outputValueEnd  : outputEnd
    );
    
    if shouldEmbedTargetBlock,
       let targetBlock = self.targetBlock
    {
      let rangeInterpolatorTargetBlock = { (value: InterpolatableValue) in
        // note: target receives a copy/"snapshot" of self
        targetBlock(self, value);
      };
      
      interpolator.targetBlock = { _, value in
        rangeInterpolatorTargetBlock(value);
      };
    };
    
    return interpolator;
  };
  
  func compute(
    usingInputValue inputValue: CGFloat,
    currentInterpolationIndex: Int? = nil
  ) -> (
    interpolatedValue: InterpolatableValue,
    interpolationMode: RangeInterpolationMode
  ) {
  
    let matchInterpolator = self.outputInterpolators.getInterpolator(
      forInputValue: inputValue,
      withStartIndex: currentInterpolationIndex
    );
    
    if let (interpolatorIndex, interpolator) = matchInterpolator {
      return (
        interpolatedValue: interpolator.compute(usingInputValue: inputValue),
        interpolationMode: .interpolate(interpolatorIndex: interpolatorIndex)
      );
    };
    
    // extrapolate left
    if inputValue < self.rangeInput.first! {
      return (
        interpolatedValue: self.outputExtrapolatorLeft.compute(usingInputValue: inputValue),
        interpolationMode: .extrapolateLeft
      );
    };
    
    // extrapolate right
    if inputValue > rangeInput.last! {
      return (
        interpolatedValue: self.outputExtrapolatorRight.compute(usingInputValue: inputValue),
        interpolationMode: .extrapolateRight
      );
    };
    
    // this shouldn't be called
    let result = InterpolatableType.rangedLerp(
      inputValue: inputValue,
      inputValueStart: self.rangeInput.first!,
      inputValueEnd: self.rangeInput.last!,
      outputValueStart: self.rangeOutput.first!,
      outputValueEnd: self.rangeOutput.last!
    );
    
    return (result, .interpolate(interpolatorIndex: 0));
  };
  
  func compute(
    usingInputPercent inputPercent: CGFloat,
    currentInterpolationIndex: Int? = nil
  ) -> (
    result: InterpolatableValue,
    interpolationMode: RangeInterpolationMode,
    inputValue: CGFloat
  ) {
    
    let inputValue = self.interpolateRangeInput(inputPercent: inputPercent);
    let (result, interpolationMode) = self.compute(usingInputValue: inputValue);
    
    return (result, interpolationMode, inputValue);
  };
  
  @discardableResult
  func computeAndApplyToTarget(
    usingInputValue inputValue: CGFloat,
    currentInterpolationIndex: Int? = nil
  ) -> RangeInterpolationMode? {
  
    guard let targetBlock = self.targetBlock else {
      return nil;
    };
    
    let (result, interpolationMode) = self.compute(
      usingInputValue: inputValue,
      currentInterpolationIndex: currentInterpolationIndex
    );
    
    targetBlock(self, result);
    return interpolationMode;
  };
  
  @discardableResult
  func computeAndApplyToTarget(
    usingInputPercent inputPercent: CGFloat,
    currentInterpolationIndex: Int? = nil
  )  -> (
    interpolationMode: RangeInterpolationMode,
    inputValue: CGFloat
  )? {
    
    let inputValue = self.interpolateRangeInput(
      inputPercent: inputPercent,
      currentInterpolationIndex: currentInterpolationIndex
    );
    
    let interpolationMode = self.computeAndApplyToTarget(
      usingInputValue: inputValue,
      currentInterpolationIndex: currentInterpolationIndex
    );
    
    guard let interpolationMode = interpolationMode else {
      return nil;
    };
    
    return (interpolationMode, inputValue);
  };
  
  // MARK: Internal Helpers
  // ----------------------
  
  internal func checkIfValid(
    rangeStartIndex: Int,
    rangeEndIndex: Int
  ) throws {
    
    guard rangeStartIndex >= 0 && rangeStartIndex < self.rangeInput.count else {
      throw GenericError(
        errorCode: .indexOutOfBounds,
        description: "startIndex out of bounds"
      );
    };
    
    guard rangeEndIndex >= 0 && rangeEndIndex < self.rangeInput.count else {
      throw GenericError(
        errorCode: .indexOutOfBounds,
        description: "endIndex out of bounds"
      );
    };
    
    guard rangeStartIndex != rangeEndIndex else {
      throw GenericError(
        errorCode: .indexOutOfBounds,
        description: "startIndex and endIndex cannot be the same"
      );
    };
  };
};

// MARK: - RangeInterpolating+StaticHelpers
// ----------------------------------------

extension RangeInterpolating {
  public static var genericType: InterpolatableValue.Type {
    return InterpolatableValue.self;
  };
  
  internal static func checkIfValid(
    rangeInput: [CGFloat],
    rangeOutput: [InterpolatableValue]
  ) throws {
    guard rangeInput.count == rangeOutput.count else {
      throw GenericError(
        errorCode: .invalidArgument,
        description: "count of rangeInput and rangeOutput are different"
      );
    };
    
    guard rangeInput.count >= 2 else {
      throw GenericError(
        errorCode: .invalidArgument,
        description: "rangeInput and rangeOutput must have at least contain 2 items"
      );
    };
  };
};

// MARK: - RangeInterpolating+RangeInterpolatorStateTracking
// ---------------------------------------------------------

extension RangeInterpolating where Self: RangeInterpolatorStateTracking {

  mutating func interpolate(
    usingInputValue inputValue: CGFloat,
    shouldUpdateState: Bool = true
  ) -> InterpolatableValue {
  
    let (result, interpolationMode) = self.compute(
      usingInputValue: inputValue,
      currentInterpolationIndex: self.currentInterpolationIndex
    );
    
    self.interpolationModePrevious = self.interpolationModeCurrent;
    self.interpolationModeCurrent = interpolationMode;
    
    return result;
  };
  
  mutating func interpolate(
    usingInputPercent inputPercent: CGFloat,
    shouldUpdateState: Bool = true
  ) -> InterpolatableValue {
  
    let inputValue = self.interpolateRangeInput(inputPercent: inputPercent);
    
    return self.interpolate(
      inputValue: inputValue,
      shouldUpdateState: shouldUpdateState
    );
  };

  mutating func interpolateAndApplyToTarget(
    usingInputValue inputValue: CGFloat,
    shouldUpdateState: Bool = true
  ){
    guard let targetBlock = self.targetBlock else { return };
    
    let result = self.interpolate(
      inputValue: inputValue,
      shouldUpdateState: shouldUpdateState
    );
    
    targetBlock(self, result);
  };
  
  mutating func interpolateAndApplyToTarget(
    usingInputPercent inputPercent: CGFloat,
    shouldUpdateState: Bool = true
  ){
    guard let targetBlock = self.targetBlock else { return };
    
    let result = self.interpolate(
      inputPercent: inputPercent,
      shouldUpdateState: shouldUpdateState
    );
    
    targetBlock(self, result);
  };
};
