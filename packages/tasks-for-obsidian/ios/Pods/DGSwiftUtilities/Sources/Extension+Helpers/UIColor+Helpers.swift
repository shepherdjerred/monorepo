//
//  UIColor+Helpers.swift
//  IosContextMenuExample
//
//  Created by Dominic Go on 11/12/20.
//  Copyright © 2020 Facebook. All rights reserved.
//
import UIKit;


public extension UIColor {
  
  // MARK: - Static Variables
  // ------------------------
  
  // css colors strings to UIColor
  static let cssColorsToRGB: [String: ColorRGBA] = [
    // colors red ---------------------------------
    "lightsalmon": ColorRGBA(r: 255, g: 160, b: 122),
    "salmon"     : ColorRGBA(r: 250, g: 128, b: 114),
    "darksalmon" : ColorRGBA(r: 233, g: 150, b: 122),
    "lightcoral" : ColorRGBA(r: 240, g: 128, b: 128),
    "indianred"  : ColorRGBA(r: 205, g: 92 , b: 92 ),
    "crimson"    : ColorRGBA(r: 220, g: 20 , b: 60 ),
    "firebrick"  : ColorRGBA(r: 178, g: 34 , b: 34 ),
    "red"        : ColorRGBA(r: 255, g: 0  , b: 0  ),
    "darkred"    : ColorRGBA(r: 139, g: 0  , b: 0  ),
    
    // colors orange ----------------------------
    "coral"     : ColorRGBA(r: 255, g: 127, b: 80),
    "tomato"    : ColorRGBA(r: 255, g: 99 , b: 71),
    "orangered" : ColorRGBA(r: 255, g: 69 , b: 0 ),
    "gold"      : ColorRGBA(r: 255, g: 215, b: 0 ),
    "orange"    : ColorRGBA(r: 255, g: 165, b: 0 ),
    "darkorange": ColorRGBA(r: 255, g: 140, b: 0 ),
    
    // colors green ----------------------------------------
    "lightyellow"         : ColorRGBA(r: 255, g: 255, b: 224),
    "lemonchiffon"        : ColorRGBA(r: 255, g: 250, b: 205),
    "lightgoldenrodyellow": ColorRGBA(r: 250, g: 250, b: 210),
    "papayawhip"          : ColorRGBA(r: 255, g: 239, b: 213),
    "moccasin"            : ColorRGBA(r: 255, g: 228, b: 181),
    "peachpuff"           : ColorRGBA(r: 255, g: 218, b: 185),
    "palegoldenrod"       : ColorRGBA(r: 238, g: 232, b: 170),
    "khaki"               : ColorRGBA(r: 240, g: 230, b: 140),
    "darkkhaki"           : ColorRGBA(r: 189, g: 183, b: 107),
    "yellow"              : ColorRGBA(r: 255, g: 255, b: 0  ),
    
    // colors green -------------------------------------
    "lawngreen"        : ColorRGBA(r: 124, g: 252, b: 0  ),
    "chartreuse"       : ColorRGBA(r: 127, g: 255, b: 0  ),
    "limegreen"        : ColorRGBA(r: 50 , g: 205, b: 50 ),
    "lime"             : ColorRGBA(r: 0  , g: 255, b: 0  ),
    "forestgreen"      : ColorRGBA(r: 34 , g: 139, b: 34 ),
    "green"            : ColorRGBA(r: 0  , g: 128, b: 0  ),
    "darkgreen"        : ColorRGBA(r: 0  , g: 100, b: 0  ),
    "greenyellow"      : ColorRGBA(r: 173, g: 255, b: 47 ),
    "yellowgreen"      : ColorRGBA(r: 154, g: 205, b: 50 ),
    "springgreen"      : ColorRGBA(r: 0  , g: 255, b: 127),
    "mediumspringgreen": ColorRGBA(r: 0  , g: 250, b: 154),
    "lightgreen"       : ColorRGBA(r: 144, g: 238, b: 144),
    "palegreen"        : ColorRGBA(r: 152, g: 251, b: 152),
    "darkseagreen"     : ColorRGBA(r: 143, g: 188, b: 143),
    "mediumseagreen"   : ColorRGBA(r: 60 , g: 179, b: 113),
    "seagreen"         : ColorRGBA(r: 46 , g: 139, b: 87 ),
    "olive"            : ColorRGBA(r: 128, g: 128, b: 0  ),
    "darkolivegreen"   : ColorRGBA(r: 85 , g: 107, b: 47 ),
    "olivedrab"        : ColorRGBA(r: 107, g: 142, b: 35 ),
    
    // colors cyan -------------------------------------
    "lightcyan"       : ColorRGBA(r: 224, g: 255, b: 255),
    "cyan"            : ColorRGBA(r: 0  , g: 255, b: 255),
    "aqua"            : ColorRGBA(r: 0  , g: 255, b: 255),
    "aquamarine"      : ColorRGBA(r: 127, g: 255, b: 212),
    "mediumaquamarine": ColorRGBA(r: 102, g: 205, b: 170),
    "paleturquoise"   : ColorRGBA(r: 175, g: 238, b: 238),
    "turquoise"       : ColorRGBA(r: 64 , g: 224, b: 208),
    "mediumturquoise" : ColorRGBA(r: 72 , g: 209, b: 204),
    "darkturquoise"   : ColorRGBA(r: 0  , g: 206, b: 209),
    "lightseagreen"   : ColorRGBA(r: 32 , g: 178, b: 170),
    "cadetblue"       : ColorRGBA(r: 95 , g: 158, b: 160),
    "darkcyan"        : ColorRGBA(r: 0  , g: 139, b: 139),
    "teal"            : ColorRGBA(r: 0  , g: 128, b: 128),
    
    // colors blue ------------------------------------
    "powderblue"     : ColorRGBA(r: 176, g: 224, b: 230),
    "lightblue"      : ColorRGBA(r: 173, g: 216, b: 230),
    "lightskyblue"   : ColorRGBA(r: 135, g: 206, b: 250),
    "skyblue"        : ColorRGBA(r: 135, g: 206, b: 235),
    "deepskyblue"    : ColorRGBA(r: 0  , g: 191, b: 255),
    "lightsteelblue" : ColorRGBA(r: 176, g: 196, b: 222),
    "dodgerblue"     : ColorRGBA(r: 30 , g: 144, b: 255),
    "cornflowerblue" : ColorRGBA(r: 100, g: 149, b: 237),
    "steelblue"      : ColorRGBA(r: 70 , g: 130, b: 180),
    "royalblue"      : ColorRGBA(r: 65 , g: 105, b: 225),
    "blue"           : ColorRGBA(r: 0  , g: 0  , b: 255),
    "mediumblue"     : ColorRGBA(r: 0  , g: 0  , b: 205),
    "darkblue"       : ColorRGBA(r: 0  , g: 0  , b: 139),
    "navy"           : ColorRGBA(r: 0  , g: 0  , b: 128),
    "midnightblue"   : ColorRGBA(r: 25 , g: 25 , b: 112),
    "mediumslateblue": ColorRGBA(r: 123, g: 104, b: 238),
    "slateblue"      : ColorRGBA(r: 106, g: 90 , b: 205),
    "darkslateblue"  : ColorRGBA(r: 72 , g: 61 , b: 139),
    
    // colors purple -------------------------------
    "lavender"    : ColorRGBA(r: 230, g: 230, b: 250),
    "thistle"     : ColorRGBA(r: 216, g: 191, b: 216),
    "plum"        : ColorRGBA(r: 221, g: 160, b: 221),
    "violet"      : ColorRGBA(r: 238, g: 130, b: 238),
    "orchid"      : ColorRGBA(r: 218, g: 112, b: 214),
    "fuchsia"     : ColorRGBA(r: 255, g: 0  , b: 255),
    "magenta"     : ColorRGBA(r: 255, g: 0  , b: 255),
    "mediumorchid": ColorRGBA(r: 186, g: 85 , b: 211),
    "mediumpurple": ColorRGBA(r: 147, g: 112, b: 219),
    "blueviolet"  : ColorRGBA(r: 138, g: 43 , b: 226),
    "darkviolet"  : ColorRGBA(r: 148, g: 0  , b: 211),
    "darkorchid"  : ColorRGBA(r: 153, g: 50 , b: 204),
    "darkmagenta" : ColorRGBA(r: 139, g: 0  , b: 139),
    "purple"      : ColorRGBA(r: 128, g: 0  , b: 128),
    "indigo"      : ColorRGBA(r: 75 , g: 0  , b: 130),
    
    // colors pink ------------------------------------
    "pink"           : ColorRGBA(r: 255, g: 192, b: 203),
    "lightpink"      : ColorRGBA(r: 255, g: 182, b: 193),
    "hotpink"        : ColorRGBA(r: 255, g: 105, b: 180),
    "deeppink"       : ColorRGBA(r: 255, g: 20 , b: 147),
    "palevioletred"  : ColorRGBA(r: 219, g: 112, b: 147),
    "mediumvioletred": ColorRGBA(r: 199, g: 21 , b: 133),
    
    // colors white ---------------------------------
    "white"        : ColorRGBA(r: 255, g: 255, b: 255),
    "snow"         : ColorRGBA(r: 255, g: 250, b: 250),
    "honeydew"     : ColorRGBA(r: 240, g: 255, b: 240),
    "mintcream"    : ColorRGBA(r: 245, g: 255, b: 250),
    "azure"        : ColorRGBA(r: 240, g: 255, b: 255),
    "aliceblue"    : ColorRGBA(r: 240, g: 248, b: 255),
    "ghostwhite"   : ColorRGBA(r: 248, g: 248, b: 255),
    "whitesmoke"   : ColorRGBA(r: 245, g: 245, b: 245),
    "seashell"     : ColorRGBA(r: 255, g: 245, b: 238),
    "beige"        : ColorRGBA(r: 245, g: 245, b: 220),
    "oldlace"      : ColorRGBA(r: 253, g: 245, b: 230),
    "floralwhite"  : ColorRGBA(r: 255, g: 250, b: 240),
    "ivory"        : ColorRGBA(r: 255, g: 255, b: 240),
    "antiquewhite" : ColorRGBA(r: 250, g: 235, b: 215),
    "linen"        : ColorRGBA(r: 250, g: 240, b: 230),
    "lavenderblush": ColorRGBA(r: 255, g: 240, b: 245),
    "mistyrose"    : ColorRGBA(r: 255, g: 228, b: 225),
    
    // colors gray -----------------------------------
    "gainsboro"     : ColorRGBA(r: 220, g: 220, b: 220),
    "lightgray"     : ColorRGBA(r: 211, g: 211, b: 211),
    "silver"        : ColorRGBA(r: 192, g: 192, b: 192),
    "darkgray"      : ColorRGBA(r: 169, g: 169, b: 169),
    "gray"          : ColorRGBA(r: 128, g: 128, b: 128),
    "dimgray"       : ColorRGBA(r: 105, g: 105, b: 105),
    "lightslategray": ColorRGBA(r: 119, g: 136, b: 153),
    "slategray"     : ColorRGBA(r: 112, g: 128, b: 144),
    "darkslategray" : ColorRGBA(r: 47 , g: 79 , b: 79 ),
    "black"         : ColorRGBA(r: 0  , g: 0  , b: 0  ),
    
    // colors brown ----------------------------------
    "cornsilk"      : ColorRGBA(r: 255, g: 248, b: 220),
    "blanchedalmond": ColorRGBA(r: 255, g: 235, b: 205),
    "bisque"        : ColorRGBA(r: 255, g: 228, b: 196),
    "navajowhite"   : ColorRGBA(r: 255, g: 222, b: 173),
    "wheat"         : ColorRGBA(r: 245, g: 222, b: 179),
    "burlywood"     : ColorRGBA(r: 222, g: 184, b: 135),
    "tan"           : ColorRGBA(r: 210, g: 180, b: 140),
    "rosybrown"     : ColorRGBA(r: 188, g: 143, b: 143),
    "sandybrown"    : ColorRGBA(r: 244, g: 164, b: 96 ),
    "goldenrod"     : ColorRGBA(r: 218, g: 165, b: 32 ),
    "peru"          : ColorRGBA(r: 205, g: 133, b: 63 ),
    "chocolate"     : ColorRGBA(r: 210, g: 105, b: 30 ),
    "saddlebrown"   : ColorRGBA(r: 139, g: 69 , b: 19 ),
    "sienna"        : ColorRGBA(r: 160, g: 82 , b: 45 ),
    "brown"         : ColorRGBA(r: 165, g: 42 , b: 42 ),
    "maroon"        : ColorRGBA(r: 128, g: 0  , b: 0  )
  ];
  
  // MARK: - Static Functions
  // ------------------------
  
  static func normalizeHexString(_ hex: String?) -> String {
    guard var hexString = hex else {
      return "00000000";
    };
    
    if hexString.hasPrefix("#") {
      hexString = String(hexString.dropFirst());
    };
    
    if hexString.count == 3 || hexString.count == 4 {
      hexString = hexString.map { "\($0)\($0)" }.joined();
    };
    
    let hasAlpha = hexString.count > 7;
    if !hasAlpha {
      hexString += "ff";
    };
    
    return hexString;
  };
  
  @available(iOS 13.0, *)
  static func elementColorFromString(_ string: String) -> UIColor? {
    switch string {
      // Label Colors
      case "label": return .label;
      case "secondaryLabel": return .secondaryLabel;
      case "tertiaryLabel": return .tertiaryLabel;
      case "quaternaryLabel": return .quaternaryLabel;

      // Fill Colors
      case "systemFill": return .systemFill;
      case "secondarySystemFill": return .secondarySystemFill;
      case "tertiarySystemFill": return .tertiarySystemFill;
      case "quaternarySystemFill": return .quaternarySystemFill;

      // Text Colors
      case "placeholderText": return .placeholderText;

      // Standard Content Background Colors
      case "systemBackground": return .systemBackground;
      case "secondarySystemBackground": return .secondarySystemBackground;
      case "tertiarySystemBackground": return .tertiarySystemBackground;

      // Grouped Content Background Colors
      case "systemGroupedBackground": return .systemGroupedBackground;
      case "secondarySystemGroupedBackground": return .secondarySystemGroupedBackground;
      case "tertiarySystemGroupedBackground": return .tertiarySystemGroupedBackground;

      // Separator Colors
      case "separator": return .separator;
      case "opaqueSeparator": return .opaqueSeparator;

      // Link Color
      case "link": return .link;

      // Non-adaptable Colors
      case "darkText": return .darkText;
      case "lightText": return .lightText;
      
      default: return nil;
    };
  };
  
  static func systemColorFromString(_ string: String) -> UIColor? {
    switch string {
      // Adaptable Colors
      case "systemBlue"  : return .systemBlue;
      case "systemGreen" : return .systemGreen;
      case "systemOrange": return .systemOrange;
      case "systemPink"  : return .systemPink;
      case "systemPurple": return .systemPurple;
      case "systemRed"   : return .systemRed;
      case "systemTeal"  : return .systemTeal;
      case "systemYellow": return .systemYellow;
      
      default: break;
    };
    
    if #available(iOS 13.0, *) {
      switch string {
        case "systemIndigo" : return .systemIndigo;
        
        //Adaptable Gray Colors
        case "systemGray" : return .systemGray;
        case "systemGray2": return .systemGray2;
        case "systemGray3": return .systemGray3;
        case "systemGray4": return .systemGray4;
        case "systemGray5": return .systemGray5;
        case "systemGray6": return .systemGray6;
          
        default: break;
      };
    };
    
    return nil;
  };
  
  /// Parse "react native" color to `UIColor`
  /// Swift impl. `RCTConvert` color
  static func parseColor(value: Any) -> UIColor? {
    if let string = value as? String {
      if #available(iOS 13.0, *),
         let color = Self.elementColorFromString(string) {
        
        // a: iOS 13+ ui enum colors
        return color;
        
      } else if let color = Self.systemColorFromString(string) {
        // b: iOS system enum colors
        return color;
        
      } else {
        // c: react-native color string
        return UIColor(cssColor: string);
      };
      
    } else if let dict = value as? NSDictionary {
      // d: react-native DynamicColor object
      return UIColor(dynamicDict: dict);
    };
    
    return nil;
  };
  
  // MARK: - Computed Properties
  // ---------------------------
  
  var rgba: (r: CGFloat, g: CGFloat, b: CGFloat, a: CGFloat) {
    var red  : CGFloat = 0;
    var green: CGFloat = 0;
    var blue : CGFloat = 0;
    var alpha: CGFloat = 0;
    
    getRed(&red, green: &green, blue: &blue, alpha: &alpha);
    return (red, green, blue, alpha);
  };
  
  var components: [CGFloat] {
    let rgba = self.rgba;
    return [rgba.r, rgba.g, rgba.b, rgba.a];
  };
  
  // MARK: - Init
  // ------------
  
  /// create color from css color code string
  convenience init?(cssColorCode: String) {
    guard let color = Self.cssColorsToRGB[cssColorCode.lowercased()]
    else { return nil };
    
    self.init(red: color.r, green: color.g, blue: color.b, alpha: 1);
  };
  
  /// create color from hex color string
  convenience init?(hexString: String) {
    guard hexString.hasPrefix("#") else { return nil };
    let hexColor: String = Self.normalizeHexString(hexString);
    
    // invalid hex string
    guard hexColor.count == 8 else { return nil };
    
    var hexNumber: UInt64 = 0;
    let scanner = Scanner(string: hexColor);
    
    // failed to convert hex string
    guard scanner.scanHexInt64(&hexNumber) else { return nil };

    self.init(
      red  : CGFloat((hexNumber & 0xff000000) >> 24) / 255,
      green: CGFloat((hexNumber & 0x00ff0000) >> 16) / 255,
      blue : CGFloat((hexNumber & 0x0000ff00) >> 8 ) / 255,
      alpha: CGFloat( hexNumber & 0x000000ff) / 255
    );
  };
  
  /// create color from rgb/rgba string
  convenience init?(rgbString: String){
    // create mutable copy...
    var rgbString = rgbString;
    
    // check if rgba() string
    let hasAlpha = rgbString.hasPrefix("rgba");
    
    // remove "rgb(" or "rgba" prefix
    rgbString = rgbString.replacingOccurrences(
      of: hasAlpha ? "rgba(" : "rgb(",
      with: "",
      options: [.caseInsensitive]
    );
    
    // remove ")" suffix
    rgbString = rgbString.replacingOccurrences(
      of: ")", with: "", options: [.backwards]
    );
    
    // split up the rgb values seperated by ","
    let split = rgbString.components(separatedBy: ",");
    
    // convert to array of float
    let colors = split.compactMap {
      NumberFormatter().number(from: $0) as? CGFloat;
    };
    
    if(colors.count == 3) {
      // create UIColor from rgb(...) string
      self.init(
        red  : colors[0] / 255,
        green: colors[1] / 255,
        blue : colors[2] / 255,
        alpha: 1
      );
      
    } else if(colors.count == 4) {
      // create UIColor from rgba(...) string
      self.init(
        red  : colors[0] / 255,
        green: colors[1] / 255,
        blue : colors[2] / 255,
        alpha: colors[3]
      );
      
    } else {
      // invalid rgb color string
      // color array is < 3 or > 4
      return nil;
    };
  };
  
  /// create color from rgb/rgba/hex/csscolor strings
  convenience init?(cssColor: String){
    // remove whitespace characters
    let colorString = cssColor.trimmingCharacters(in: .whitespacesAndNewlines);
    
    if colorString.hasPrefix("#"){
      self.init(hexString: colorString);
      return;
      
    } else if colorString.hasPrefix("rgb") {
      self.init(rgbString: colorString);
      
    } else if let color = Self.cssColorsToRGB[colorString.lowercased()] {
      self.init(red: color.r, green: color.g, blue: color.b, alpha: 1);
      return;
      
    } else {
      return nil;
    };
  };
  
  /// create color from `DynamicColorIOS` dictionary
  convenience init?(dynamicDict: NSDictionary) {
    var dict = dynamicDict;
    
    if let innerDict = dynamicDict["dynamic"] as? NSDictionary {
      dict = innerDict;
    };
  
    guard let stringDark  = dict["dark" ] as? String,
          let stringLight = dict["light"] as? String
    else {
      return nil;
    };
    
    if #available(iOS 13.0, *),
       let colorDark  = UIColor(cssColor: stringDark ),
       let colorLight = UIColor(cssColor: stringLight) {
      
      self.init(dynamicProvider: { traitCollection in
        switch traitCollection.userInterfaceStyle {
          case .dark : return colorDark;
          case .light: return colorLight;
            
          case .unspecified: fallthrough;
          @unknown default : return .clear;
        };
      });
      
    } else {
      self.init(cssColor: stringLight);
    };
  };
};
