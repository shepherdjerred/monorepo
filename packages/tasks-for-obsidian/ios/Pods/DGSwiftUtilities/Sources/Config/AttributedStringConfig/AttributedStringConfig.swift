//
//  AttributedStringConfig.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/9/24.
//

import UIKit

// TODO: Move to `SwiftUtilities`
public struct AttributedStringConfig: Equatable {

  public static let newLine: Self = .init(text: "\n");
  
  public static func newLines(_ count: Int) -> Self {
    .init(text: String(repeating: "\n", count: count));
  };
  
  //static var attributesMap: PartialKeyPath<Self>
  
  // MARK: Properties
  // ----------------

  public var text: String;
  public var fontConfig: FontConfig;
  
  public var paragraphStyle: NSParagraphStyle;
  public var foregroundColor: UIColor?;
  public var backgroundColor: UIColor?;
  
  public var strikethroughStyle: NSUnderlineStyle?;
  public var strikethroughColor: UIColor?;
  
  public var underlineStyle: NSUnderlineStyle?;
  public var underlineColor: UIColor?;
  
  public var strokeColor: UIColor?;
  public var strokeWidth: CGFloat?;
  
  // TODO: - TBA:
  // ligature
  // kern
  // tracking
  // shadow
  // textEffect
  // attachment
  // link
  // baselineOffset
  // writingDirection
  
  // MARK: - Computed Properties
  // ---------------------------
  
  public var attributes: [NSAttributedString.Key: Any] {
    var attributes: [NSAttributedString.Key: Any] = [:];
    
    attributes[.font] = self.fontConfig.makeFont();
    attributes[.paragraphStyle] = self.paragraphStyle;
    
    attributes[.foregroundColor] = self.foregroundColor ?? {
      if #available(iOS 13.0, *) {
        return .label;
      };
      
      return .black;
    }();
    
    if let backgroundColor = self.backgroundColor {
      attributes[.backgroundColor] = backgroundColor;
    };
    
    if let strikethroughStyle = self.strikethroughStyle {
      attributes[.strikethroughStyle] = strikethroughStyle;
    };
    
    if let strikethroughColor = self.strikethroughColor {
      attributes[.strikethroughColor] = strikethroughColor;
    };
    
    if let underlineStyle = self.underlineStyle {
      attributes[.underlineStyle] = underlineStyle;
    };
    
    if let underlineColor = self.underlineColor {
      attributes[.underlineColor] = underlineColor;
    };
    
    if let strokeColor = self.strokeColor {
      attributes[.strokeColor] = strokeColor;
    };
    
    if let strokeWidth = self.strokeWidth {
      attributes[.strokeWidth] = strokeWidth;
    };
    
    return attributes;
  };
  
  // MARK: Init
  // ----------
  
  public init(
    fontConfig: FontConfig = .default,
    paragraphStyle: NSParagraphStyle = .default,
    color: UIColor? = nil,
    backgroundColor: UIColor? = nil,
    strikethroughStyle: NSUnderlineStyle? = nil,
    strikethroughColor: UIColor? = nil,
    underlineStyle: NSUnderlineStyle? = nil,
    underlineColor: UIColor? = nil,
    strokeColor: UIColor? = nil,
    strokeWidth: CGFloat? = nil
  ) {
    self.text = "";
    self.fontConfig = fontConfig;
    self.paragraphStyle = paragraphStyle;
    self.foregroundColor = color;
    self.backgroundColor = backgroundColor;
    self.strikethroughStyle = strikethroughStyle;
    self.strikethroughColor = strikethroughColor;
    self.underlineStyle = underlineStyle;
    self.underlineColor = underlineColor;
    self.strokeColor = strokeColor;
    self.strokeWidth = strokeWidth;
  };
  
  public init(
    text: String,
    fontConfig: FontConfig = .default,
    paragraphStyle: NSParagraphStyle = .default,
    color: UIColor? = nil,
    backgroundColor: UIColor? = nil,
    strikethroughStyle: NSUnderlineStyle? = nil,
    strikethroughColor: UIColor? = nil,
    underlineStyle: NSUnderlineStyle? = nil,
    underlineColor: UIColor? = nil,
    strokeColor: UIColor? = nil,
    strokeWidth: CGFloat? = nil
  ) {
  
    self.text = text;
    self.fontConfig = fontConfig;
    self.paragraphStyle = paragraphStyle;
    self.foregroundColor = color;
    self.backgroundColor = backgroundColor;
    self.strikethroughStyle = strikethroughStyle;
    self.strikethroughColor = strikethroughColor;
    self.underlineStyle = underlineStyle;
    self.underlineColor = underlineColor;
    self.strokeColor = strokeColor;
    self.strokeWidth = strokeWidth;
  };
  
  public init(
    text: String,
    size: CGFloat = UIFont.systemFontSize,
    weight: UIFont.Weight = .regular,
    isBold: Bool = false,
    isItalic: Bool = false,
    width: FontConfig.FontWidth = .default,
    paragraphStyle: NSParagraphStyle = .default,
    color: UIColor? = nil,
    backgroundColor: UIColor? = nil,
    strikethroughStyle: NSUnderlineStyle? = nil,
    strikethroughColor: UIColor? = nil,
    underlineStyle: NSUnderlineStyle? = nil,
    underlineColor: UIColor? = nil,
    strokeColor: UIColor? = nil,
    strokeWidth: CGFloat? = nil
  ) {
  
    let fontConfig = FontConfig(
      size: size,
      weight: weight,
      isBold: isBold,
      isItalic: isItalic,
      width: width
    );
    
    self.init(
      text: text,
      fontConfig: fontConfig,
      paragraphStyle: paragraphStyle,
      color: color,
      backgroundColor: backgroundColor,
      strikethroughStyle: strikethroughStyle,
      strikethroughColor: strikethroughColor,
      underlineStyle: underlineStyle,
      underlineColor: underlineColor,
      strokeColor: strokeColor,
      strokeWidth: strokeWidth
    );
  };
  
  // MARK: - Functions
  // -----------------
  
  public func modifiedCopy(withNewText newText: String) -> Self {
    var copy = self;
    copy.text = newText;
    
    return copy;
  };
  
  public func makeAttributedString() -> NSMutableAttributedString {
    return .init(
      string: self.text,
      attributes: self.attributes
    );
  };
  
  public func makeAttributedString(
    withNewText newText: String
  ) -> NSMutableAttributedString {
  
    self.modifiedCopy(withNewText: newText).makeAttributedString();
  };
};

// MARK: - AttributedStringConfig+StaticHelpers
// --------------------------------------------

public extension AttributedStringConfig {

  static func createTimestamp(
    fontConfig: FontConfig? = nil
  ) -> Self {
    .init(
      text: .createTimestamp(),
      fontConfig: fontConfig ?? .init(
        size: nil,
        weight: nil,
        symbolicTraits: [
          .traitMonoSpace,
          .traitBold,
        ]
      )
    );
  };
};

