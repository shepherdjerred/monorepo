//
//  ComputableLayout.swift
//  swift-programmatic-modal
//
//  Created by Dominic Go on 5/19/23.
//

import UIKit
import DGSwiftUtilities

public struct ComputableLayout: Equatable {

  public static let zero: Self = .init(
    horizontalAlignment: .left,
    verticalAlignment: .top,
    width: .constant(0),
    height: .constant(0)
  );
  
  // MARK: - Properties
  // ------------------
  
  public let horizontalAlignment: HorizontalAlignment;
  public let verticalAlignment  : VerticalAlignment;
  
  public let width : ComputableLayoutValue;
  public let height: ComputableLayoutValue;
  
  public let marginLeft  : ComputableLayoutValue?;
  public let marginRight : ComputableLayoutValue?;
  public let marginTop   : ComputableLayoutValue?;
  public let marginBottom: ComputableLayoutValue?;
  
  public let paddingLeft  : ComputableLayoutValue?;
  public let paddingRight : ComputableLayoutValue?;
  public let paddingTop   : ComputableLayoutValue?;
  public let paddingBottom: ComputableLayoutValue?;
  
  public let offsetX: ComputableLayoutValue?;
  public let offsetY: ComputableLayoutValue?;
  
  // MARK: - Init
  // ------------
  
  public init(
    horizontalAlignment: HorizontalAlignment,
    verticalAlignment  : VerticalAlignment,
    
    width : ComputableLayoutValue,
    height: ComputableLayoutValue,
    
    marginLeft  : ComputableLayoutValue? = nil,
    marginRight : ComputableLayoutValue? = nil,
    marginTop   : ComputableLayoutValue? = nil,
    marginBottom: ComputableLayoutValue? = nil,
    
    paddingLeft  : ComputableLayoutValue? = nil,
    paddingRight : ComputableLayoutValue? = nil,
    paddingTop   : ComputableLayoutValue? = nil,
    paddingBottom: ComputableLayoutValue? = nil,
    
    offsetX: ComputableLayoutValue? = nil,
    offsetY: ComputableLayoutValue? = nil
  ) {
    self.horizontalAlignment = horizontalAlignment;
    self.verticalAlignment   = verticalAlignment;
    
    self.width  = width;
    self.height = height;
    
    self.marginLeft   = marginLeft;
    self.marginRight  = marginRight;
    self.marginTop    = marginTop;
    self.marginBottom = marginBottom;
    
    self.paddingLeft   = paddingLeft;
    self.paddingRight  = paddingRight;
    self.paddingTop    = paddingTop;
    self.paddingBottom = paddingBottom;
    
    self.offsetX = offsetX;
    self.offsetY = offsetY;
  };
  
  public init(
    derivedFrom prev: Self,
    horizontalAlignment: HorizontalAlignment? = nil,
    verticalAlignment  : VerticalAlignment? = nil,
    
    width : ComputableLayoutValue? = nil,
    height: ComputableLayoutValue? = nil,
    
    marginLeft  : ComputableLayoutValue? = nil,
    marginRight : ComputableLayoutValue? = nil,
    marginTop   : ComputableLayoutValue? = nil,
    marginBottom: ComputableLayoutValue? = nil,
    
    paddingLeft  : ComputableLayoutValue? = nil,
    paddingRight : ComputableLayoutValue? = nil,
    paddingTop   : ComputableLayoutValue? = nil,
    paddingBottom: ComputableLayoutValue? = nil,
    
    offsetX: ComputableLayoutValue? = nil,
    offsetY: ComputableLayoutValue? = nil
  ) {
    self.horizontalAlignment = horizontalAlignment ?? prev.horizontalAlignment;
    self.verticalAlignment   = verticalAlignment   ?? prev.verticalAlignment;
    
    self.width  = width  ?? prev.width;
    self.height = height ?? prev.height;
    
    self.marginLeft   = marginLeft   ?? prev.marginLeft;
    self.marginRight  = marginRight  ?? prev.marginRight;
    self.marginTop    = marginTop    ?? prev.marginTop;
    self.marginBottom = marginBottom ?? prev.marginBottom;
    
    self.paddingLeft   = paddingLeft   ?? prev.paddingLeft;
    self.paddingRight  = paddingRight  ?? prev.paddingRight;
    self.paddingTop    = paddingTop    ?? prev.paddingTop;
    self.paddingBottom = paddingBottom ?? prev.paddingBottom;
    
    self.offsetX = offsetX ?? prev.offsetX;
    self.offsetY = offsetY ?? prev.offsetY;
  };
  
  public init(
    rect: CGRect,
    paddingLeft  : ComputableLayoutValue? = nil,
    paddingRight : ComputableLayoutValue? = nil,
    paddingTop   : ComputableLayoutValue? = nil,
    paddingBottom: ComputableLayoutValue? = nil
  ){
    self.horizontalAlignment = .left;
    self.verticalAlignment   = .top;
  
    self.width  = .constant(rect.width);
    self.height = .constant(rect.height);
    
    self.marginLeft   = nil;
    self.marginRight  = nil;
    self.marginTop    = nil;
    self.marginBottom = nil;
  
    self.paddingLeft   = paddingLeft;
    self.paddingRight  = paddingRight;
    self.paddingTop    = paddingTop;
    self.paddingBottom = paddingBottom;
    
    self.offsetX = .constant(rect.origin.x);
    self.offsetY = .constant(rect.origin.y);
  };
  
  // MARK: - Intermediate Functions
  // ------------------------------
  
  /// Compute Rect - Step 1
  /// * Rect with the computed size based on `size` config.
  ///
  public func computeRawRectSize(
    usingLayoutValueContext context: ComputableLayoutValueContext
  ) -> CGSize {
  
    let computedWidth = self.width.computeValue(
      usingLayoutValueContext: context,
      preferredSizeKey: \.width
    );
    
    let computedHeight = self.height.computeValue(
      usingLayoutValueContext: context,
      preferredSizeKey: \.height
    );
    
    return CGSize(
      width : computedWidth  ?? 0,
      height: computedHeight ?? 0
    );
  };
  
  /// Compute Rect - Step 2
  /// * Rect with the origin based on `horizontalAlignment`, and
  ///   `verticalAlignment` config.
  ///
  public func computeRawRectOrigin(
    usingLayoutValueContext context: ComputableLayoutValueContext,
    forRect rect: CGRect? = nil,
    ignoreXAxis: Bool = false,
    ignoreYAxis: Bool = false
  ) -> CGRect {
  
    let origin = rect?.origin ?? .zero;
    let size = rect?.size ?? context.currentSize ?? .zero;
    
    var rect = CGRect(origin: origin, size: size);
    
    if !ignoreXAxis {
      // Compute Origin - X
      switch self.horizontalAlignment {
        case .center:
          rect.setPoint(midX: context.targetRect.midX);
          
        case .left:
          rect.setPoint(minX: context.targetRect.minX);
          
        case .right:
          rect.setPoint(maxX: context.targetRect.maxX);
      };
    };
    
    if !ignoreYAxis {
      // Compute Origin - Y
      switch self.verticalAlignment {
        case .center:
          rect.setPoint(midY: context.targetRect.midY);
          
        case .top:
          rect.setPoint(minY: context.targetRect.minY);
          
        case .bottom:
          rect.origin.y = context.targetRect.height - rect.height;
      };
    };
    
    return rect;
  };
  
  // MARK: - Functions
  // -----------------
  
  /// Compute Rect - Step 3
  /// * Rect with the computed size based on `size` config.
  ///
  /// * Rect with the origin based on `horizontalAlignment`, and
  ///   `verticalAlignment` config.
  ///
  /// * Rect with margins applied to it based on the margin-related properties
  ///
  public func computeRect(
    usingLayoutValueContext baseContext: ComputableLayoutValueContext
  ) -> CGRect {
  
    let computedSize = self.computeRawRectSize(
      usingLayoutValueContext: baseContext
    );
    
    let context = ComputableLayoutValueContext(
      derivedFrom: baseContext,
      currentSize: computedSize
    );
  
    var rect = self.computeRawRectOrigin(usingLayoutValueContext: context);
    
    let computedMargins = ComputableLayoutMargins(
      usingLayoutConfig: self,
      usingLayoutValueContext: context
    );
    
    let marginRects = ComputableLayoutMarginRects(
      margins: computedMargins,
      viewRect: rect,
      targetRect: context.targetRect
    );
    
    let shouldResizeWidth: Bool = {
      if computedMargins.horizontal == 0 {
        return false;
      };
      
      if self.width.mode == .stretch &&
         !computedMargins.hasNegativeHorizontalMargins {
         
        return true;
      };
    
      return (
           computedMargins.left       > 0
        && computedMargins.right      > 0
        && computedMargins.horizontal > rect.width
      );
    }();
       
    let shouldResizeHeight: Bool = {
      if computedMargins.vertical == 0 {
        return false;
      };
      
      if self.height.mode == .stretch &&
         !computedMargins.hasNegativeVerticalMargins {
         
        return true;
      };
    
      return (
           computedMargins.top > 0
        && computedMargins.bottom > 0
        && computedMargins.vertical > rect.height
      );
    }();

    if shouldResizeWidth {
      let offsetWidth = self.width.mode == .stretch
        ? computedMargins.horizontal
        : computedMargins.horizontal - rect.width;
      
      rect.size.width -= offsetWidth;
    };
    
    if shouldResizeHeight {
      let offsetHeight = self.height.mode == .stretch
        ? computedMargins.vertical
        : computedMargins.vertical - rect.height;
      
      rect.size.height -= offsetHeight;
    };
    
    let shouldOffsetX: Bool = {
      switch self.horizontalAlignment {
        case .left, .right:
          return true;
          
        case .center:
          return
            marginRects.left.maxX > rect.minX ||
            marginRects.right.minX < rect.maxX;
      };
    }();
    
    let shouldOffsetY: Bool = {
      switch self.verticalAlignment {
        case .top, .bottom:
          return true;
          
        case .center:
          return
            marginRects.top.maxY > rect.minY ||
            marginRects.bottom.minY < rect.maxY;
      };
    }();
      
    if shouldOffsetX {
      let offsetLeft = computedMargins.left - rect.minX;
      
      let shouldApplyNegativeLeftMargin =
        self.horizontalAlignment == .left &&
        computedMargins.left < 0;
      
      if offsetLeft > 0 {
        rect.origin.x += offsetLeft;
        
      } else if shouldApplyNegativeLeftMargin {
        rect.origin.x -= abs(computedMargins.left);
      };
      
      let offsetRight: CGFloat = {
        let marginRightX = context.targetRect.maxX - computedMargins.right;
        return rect.maxX - marginRightX;
      }();
      
      let shouldApplyNegativeRightMargin =
        self.horizontalAlignment == .right &&
        computedMargins.right < 0;
        
      if offsetRight > 0 {
        rect.origin.x -= offsetRight;
        
      } else if shouldApplyNegativeRightMargin {
        rect.origin.x += abs(computedMargins.right);
      };
    };
    
    if shouldOffsetY {
      let offsetTop = computedMargins.top - rect.minY;
      
      let shouldApplyNegativeTopMargin =
        self.verticalAlignment == .top &&
        computedMargins.top < 0;
      
      if offsetTop > 0 {
        rect.origin.y += offsetTop;
        
      } else if shouldApplyNegativeTopMargin {
        rect.origin.y -= abs(computedMargins.top); 
      };
      
      let offsetBottom: CGFloat = {
        let marginBottomY = context.targetRect.maxY - computedMargins.bottom;
        return rect.maxY - marginBottomY;
      }();
      
      let shouldApplyNegativeBottomMargin =
        self.verticalAlignment == .bottom &&
        computedMargins.bottom < 0;
        
      if offsetBottom > 0 {
        rect.origin.y -= offsetBottom;
        
      } else if shouldApplyNegativeBottomMargin {
         rect.origin.y += abs(computedMargins.bottom);
      };
    };
    
    let shouldRecomputeXAxis: Bool = {
      switch self.horizontalAlignment {
        case .center:
          return !shouldOffsetX && shouldResizeWidth
      
        default:
          return false;
      };
    }();
    
    let shouldRecomputeYAxis: Bool = {
      switch self.verticalAlignment {
        case .center:
          return !shouldOffsetY && shouldResizeHeight
      
        default:
          return false;
      };
    }();
    
    if shouldRecomputeXAxis || shouldRecomputeYAxis {
      // re-compute origin
      rect = self.computeRawRectOrigin(
        usingLayoutValueContext: context,
        forRect: rect,
        ignoreXAxis: !shouldRecomputeXAxis,
        ignoreYAxis: !shouldRecomputeYAxis
      );
    };
    
    rect.origin.x += {
      let computedOffset = self.offsetX?.computeValue(
        usingLayoutValueContext: context,
        preferredSizeKey: \.width
      );
      
      return computedOffset ?? 0;
    }();
    
    rect.origin.y += {
      let computedOffset = self.offsetY?.computeValue(
        usingLayoutValueContext: context,
        preferredSizeKey: \.height
      );
      
      return computedOffset ?? 0;
    }();
    
    return rect;
  };
  
  public func computePadding(
    usingLayoutValueContext context: ComputableLayoutValueContext
  ) -> UIEdgeInsets {
  
    let paddingLeft = self.paddingLeft?.computeValue(
      usingLayoutValueContext: context,
      preferredSizeKey: \.width
    );
    
    let paddingRight = self.paddingRight?.computeValue(
      usingLayoutValueContext: context,
      preferredSizeKey: \.width
    );
    
    let paddingTop = self.paddingTop?.computeValue(
      usingLayoutValueContext: context,
      preferredSizeKey: \.height
    );
    
    let paddingBottom = self.paddingBottom?.computeValue(
      usingLayoutValueContext: context,
      preferredSizeKey: \.height
    );
    
    return .init(
      top   : paddingTop    ?? 0,
      left  : paddingLeft   ?? 0,
      bottom: paddingBottom ?? 0,
      right : paddingRight  ?? 0
    );
  };
};
