//
//  FontConfig.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/9/24.
//

import UIKit


// TODO: Move to `SwiftUtilities`
public struct FontConfig: Equatable {

  // MARK: - Embedded Types
  //-----------------------
  
  public enum FontWidth {
    case `default`, expanded, condensed, monospace;
    
    public var symbolicTrait: UIFontDescriptor.SymbolicTraits {
      switch self {
        case .default:
          return [];
          
        case .expanded:
          return .traitExpanded;
          
        case .condensed:
          return .traitCondensed;
          
        case .monospace:
          return .traitMonoSpace;
      };
    };
  };
  
  // MARK: - Presets
  // ---------------

  public static let `default`: Self = .init(size: UIFont.systemFontSize);
  
  // MARK: - Other Static Properties
  // -------------------------------

  public static let baseFont =
    UIFont.systemFont(ofSize: UIFont.systemFontSize);
    
  // MARK: - Properties
  // ------------------
  
  public var baseFontDescriptor = Self.baseFont.fontDescriptor;
  
  public var size: CGFloat?;
  public var weight: UIFont.Weight?;
  
  public var symbolicTraits: UIFontDescriptor.SymbolicTraits? = nil;
  
  // MARK: - Init
  // ------------
  
  public init(
    baseFontDescriptor: UIFontDescriptor = Self.baseFont.fontDescriptor,
    size: CGFloat?,
    weight: UIFont.Weight? = nil,
    isBold: Bool = false,
    isItalic: Bool = false,
    width: FontWidth? = nil
  ) {
    self.baseFontDescriptor = baseFontDescriptor;
    self.size = size;
    self.weight = weight;
    
    var didSetSymbolicTraits = false;
    var symbolicTraits: UIFontDescriptor.SymbolicTraits = [];
    
    if isBold {
      didSetSymbolicTraits = true;
      symbolicTraits = symbolicTraits.union(.traitBold);
    };
    
    if isItalic {
      didSetSymbolicTraits = true;
      symbolicTraits = symbolicTraits.union(.traitItalic);
    };
    
    if let width = width  {
      symbolicTraits = symbolicTraits.union(width.symbolicTrait);
    };
    
    if didSetSymbolicTraits {
      self.symbolicTraits = symbolicTraits;
    };
  };
  
  public init(
    baseFontDescriptor: UIFontDescriptor = Self.baseFont.fontDescriptor,
    size: CGFloat?,
    weight: UIFont.Weight?,
    symbolicTraits: UIFontDescriptor.SymbolicTraits?
  ) {
    self.baseFontDescriptor = baseFontDescriptor;
    self.size = size;
    self.weight = weight;
    self.symbolicTraits = symbolicTraits;
  };
  
  // MARK: - Functions
  // -----------------
  
  public func makeFontDescriptor() -> UIFontDescriptor {
    var descriptor = self.baseFontDescriptor;
    
    if let symbolicTraits = self.symbolicTraits,
       let nextDescriptor = descriptor.withSymbolicTraits(symbolicTraits) {
       
      descriptor = nextDescriptor;
    };
    
    var attributes = descriptor.fontAttributes;
    if let size = self.size {
      attributes[.size] = size;
    };
    
    var traits = attributes[.traits] as? [UIFontDescriptor.TraitKey: Any] ?? [:];
    if let weight = self.weight {
      traits[.weight] = weight;
    };
    
    attributes[.traits] = traits;
    descriptor = descriptor.addingAttributes(attributes);
    
    return descriptor;
  };
  
  public func makeFont() -> UIFont {
    let fontDesc = self.makeFontDescriptor();
    return UIFont(descriptor: fontDesc, size: 0);
  };
};
