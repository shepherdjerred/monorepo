//
//  Colors.swift
//  ConfigBasedModalExample
//
//  Created by Dominic Go on 6/8/24.
//

import UIKit

public enum ColorPreset: String, CaseIterable {
  case black100;
  case black200;
  case black300;
  case black400;
  case black500;
  case black600;
  case black700;
  case black800;
  case black900;

  case grey50;
  case grey100;
  case grey200;
  case grey300;
  case grey400;
  case grey500;
  case grey600;
  case grey700;
  case grey800;
  case grey900;

  case blueGrey50;
  case blueGrey100;
  case blueGrey200;
  case blueGrey300;
  case blueGrey400;
  case blueGrey500;
  case blueGrey600;
  case blueGrey700;
  case blueGrey800;
  case blueGrey900;

  case red50;
  case red100;
  case red200;
  case red300;
  case red400;
  case red500;
  case red600;
  case red700;
  case red800;
  case red900;
  case redA100;
  case redA200;
  case redA400;
  case redA700;

  case pink50;
  case pink100;
  case pink200;
  case pink300;
  case pink400;
  case pink500;
  case pink600;
  case pink700;
  case pink800;
  case pink900;
  case pinkA100;
  case pinkA200;
  case pinkA400;
  case pinkA700;

  case violet100;
  case violet200;
  case violet300;
  case violet400;
  case violet500;
  case violet600;
  case violet700;
  case violet800;
  case violet900;
  case violetA700;

  case purple25;
  case purple50;
  case purple100;
  case purple200;
  case purple300;
  case purple400;
  case purple500;
  case purple600;
  case purple700;
  case purple800;
  case purple900;
  case purple1000;
  case purple1100;
  case purple1200;
  case purple1300;
  case purpleA100;
  case purpleA200;
  case purpleA400;
  case purpleA700;

  case indigo50;
  case indigo100;
  case indigo200;
  case indigo300;
  case indigo400;
  case indigo500;
  case indigo600;
  case indigo700;
  case indigo800;
  case indigo900;
  case indigo1000;
  case indigo2000;
  case indigo3000;
  case indigoA100;
  case indigoA200;
  case indigoA400;
  case indigoA700;

  case blue50;
  case blue100;
  case blue200;
  case blue300;
  case blue400;
  case blue500;
  case blue600;
  case blue700;
  case blue800;
  case blue900;
  case blue1000;
  case blue1100;
  case blue1200;
  case blueA100;
  case blueA200;
  case blueA400;
  case blueA700;

  case green50;
  case green100;
  case green200;
  case green300;
  case green400;
  case green500;
  case green600;
  case green700;
  case green800;
  case green900;
  case greenA100;
  case greenA200;
  case greenA400;
  case greenA700;

  case lightGreen50;
  case lightGreen100;
  case lightGreen200;
  case lightGreen300;
  case lightGreen400;
  case lightGreen500;
  case lightGreen600;
  case lightGreen700;
  case lightGreen800;
  case lightGreen900;
  case lightGreenA100;
  case lightGreenA200;
  case lightGreenA400;
  case lightGreenA700;

  case yellow50;
  case yellow100;
  case yellow200;
  case yellow300;
  case yellow400;
  case yellow500;
  case yellow600;
  case yellow700;
  case yellow800;
  case yellow900;
  case yellowA100;
  case yellowA200;
  case yellowA400;
  case yellowA700;

  case amber50;
  case amber100;
  case amber200;
  case amber300;
  case amber400;
  case amber500;
  case amber600;
  case amber700;
  case amber800;
  case amber900;
  case amberA100;
  case amberA200;
  case amberA400;
  case amberA700;

  case orange50;
  case orange100;
  case orange200;
  case orange300;
  case orange400;
  case orange500;
  case orange600;
  case orange700;
  case orange800;
  case orange900;
  case orange1000;
  case orangeA100;
  case orangeA200;
  case orangeA400;
  case orangeA700;
  
  // MARK: -Computed Properties
  // --------------------------
  
  public var colorHexString: String {
    switch self {
      case .black100: return "#F5F5F5";
      case .black200: return "#EEEEEE";
      case .black300: return "#E0E0E0";
      case .black400: return "#BDBDBD";
      case .black500: return "#9E9E9E";
      case .black600: return "#757575";
      case .black700: return "#616161";
      case .black800: return "#424242";
      case .black900: return "#212121";

      case .grey50 : return "#FAFAFA";
      case .grey100: return "#F5F5F5";
      case .grey200: return "#EEEEEE";
      case .grey300: return "#E0E0E0";
      case .grey400: return "#BDBDBD";
      case .grey500: return "#9E9E9E";
      case .grey600: return "#757575";
      case .grey700: return "#616161";
      case .grey800: return "#424242";
      case .grey900: return "#212121";

      case .blueGrey50 : return "#ECEFF1";
      case .blueGrey100: return "#CFD8DC";
      case .blueGrey200: return "#B0BEC5";
      case .blueGrey300: return "#90A4AE";
      case .blueGrey400: return "#78909C";
      case .blueGrey500: return "#607D8B";
      case .blueGrey600: return "#546E7A";
      case .blueGrey700: return "#455A64";
      case .blueGrey800: return "#37474F";
      case .blueGrey900: return "#263238";

      case .red50  : return "#FFEBEE";
      case .red100 : return "#FFCDD2";
      case .red200 : return "#EF9A9A";
      case .red300 : return "#E57373";
      case .red400 : return "#EF5350";
      case .red500 : return "#F44336";
      case .red600 : return "#E53935";
      case .red700 : return "#D32F2F";
      case .red800 : return "#C62828";
      case .red900 : return "#B71C1C";
      case .redA100: return "#FF8A80";
      case .redA200: return "#FF5252";
      case .redA400: return "#FF1744";
      case .redA700: return "#D50000";

      case .pink50  : return "#FCE4EC";
      case .pink100 : return "#F8BBD0";
      case .pink200 : return "#F48FB1";
      case .pink300 : return "#F06292";
      case .pink400 : return "#EC407A";
      case .pink500 : return "#E91E63";
      case .pink600 : return "#D81B60";
      case .pink700 : return "#C2185B";
      case .pink800 : return "#AD1457";
      case .pink900 : return "#880E4F";
      case .pinkA100: return "#FF80AB";
      case .pinkA200: return "#FF4081";
      case .pinkA400: return "#F50057";
      case .pinkA700: return "#C51162";

      case .violet100 : return "#E1BEE7";
      case .violet200 : return "#CE93D8";
      case .violet300 : return "#BA68C8";
      case .violet400 : return "#AB47BC";
      case .violet500 : return "#9C27B0";
      case .violet600 : return "#8E24AA";
      case .violet700 : return "#7B1FA2";
      case .violet800 : return "#6A1B9A";
      case .violet900 : return "#4A148C";
      case .violetA700: return "#AA00FF";

      case .purple25  : return "#f1edf7";
      case .purple50  : return "#EDE7F6";
      case .purple100 : return "#D1C4E9";
      case .purple200 : return "#B39DDB";
      case .purple300 : return "#9575CD";
      case .purple400 : return "#7E57C2";
      case .purple500 : return "#673AB7";
      case .purple600 : return "#5E35B1";
      case .purple700 : return "#512DA8";
      case .purple800 : return "#4527A0";
      case .purple900 : return "#311B92";
      case .purple1000: return "#190b5b";
      case .purple1100: return "#0f0442";
      case .purple1200: return "#0e0333";
      case .purple1300: return "#090126";
      case .purpleA100: return "#B388FF";
      case .purpleA200: return "#7C4DFF";
      case .purpleA400: return "#651FFF";
      case .purpleA700: return "#6200EA";

      case .indigo50  : return "#E8EAF6";
      case .indigo100 : return "#C5CAE9";
      case .indigo200 : return "#9FA8DA";
      case .indigo300 : return "#7986CB";
      case .indigo400 : return "#5C6BC0";
      case .indigo500 : return "#3F51B5";
      case .indigo600 : return "#3949AB";
      case .indigo700 : return "#303F9F";
      case .indigo800 : return "#283593";
      case .indigo900 : return "#1A237E";
      case .indigo1000: return "#11165e";
      case .indigo2000: return "#0b0f47";
      case .indigo3000: return "#070b36";
      case .indigoA100: return "#8C9EFF";
      case .indigoA200: return "#536DFE";
      case .indigoA400: return "#3D5AFE";
      case .indigoA700: return "#304FFE";

      case .blue50  : return "#E3F2FD";
      case .blue100 : return "#BBDEFB";
      case .blue200 : return "#90CAF9";
      case .blue300 : return "#64B5F6";
      case .blue400 : return "#42A5F5";
      case .blue500 : return "#2196F3";
      case .blue600 : return "#1E88E5";
      case .blue700 : return "#1976D2";
      case .blue800 : return "#1565C0";
      case .blue900 : return "#0D47A1";
      case .blue1000: return "#093270";
      case .blue1100: return "#031f4a";
      case .blue1200: return "#001029";
      case .blueA100: return "#82B1FF";
      case .blueA200: return "#448AFF";
      case .blueA400: return "#2979FF";
      case .blueA700: return "#2962FF";

      case .green50  : return "#E8F5E9";
      case .green100 : return "#C8E6C9";
      case .green200 :  return "#A5D6A7";
      case .green300 : return "#81C784";
      case .green400 : return "#66BB6A";
      case .green500 : return "#4CAF50";
      case .green600 : return "#43A047";
      case .green700 : return "#388E3C";
      case .green800 : return "#2E7D32";
      case .green900 : return "#1B5E20";
      case .greenA100: return "#B9F6CA";
      case .greenA200: return "#69F0AE";
      case .greenA400: return "#00E676";
      case .greenA700: return "#00C853";

      case .lightGreen50  : return "#F1F8E9";
      case .lightGreen100 : return "#DCEDC8";
      case .lightGreen200 : return "#C5E1A5";
      case .lightGreen300 : return "#AED581";
      case .lightGreen400 : return "#9CCC65";
      case .lightGreen500 : return "#8BC34A";
      case .lightGreen600 : return "#7CB342";
      case .lightGreen700 : return "#689F38";
      case .lightGreen800 : return "#558B2F" ;
      case .lightGreen900 : return "#33691E";
      case .lightGreenA100: return "#CCFF90";
      case .lightGreenA200: return "#B2FF59";
      case .lightGreenA400: return "#76FF03";
      case .lightGreenA700: return "#64DD17";

      case .yellow50  : return "#FFFDE7";
      case .yellow100 : return "#FFF9C4";
      case .yellow200 : return "#FFF59D";
      case .yellow300 : return "#FFF176";
      case .yellow400 : return "#FFEE58";
      case .yellow500 : return "#FFEB3B";
      case .yellow600 : return "#FDD835";
      case .yellow700 : return "#FBC02D";
      case .yellow800 : return "#F9A825";
      case .yellow900 : return "#F57F17";
      case .yellowA100: return "#FFFF8D";
      case .yellowA200: return "#FFFF00";
      case .yellowA400: return "#FFEA00";
      case .yellowA700: return "#FFD600";

      case .amber50  : return "#FFF8E1";
      case .amber100 : return "#FFECB3";
      case .amber200 : return "#FFE082";
      case .amber300 : return "#FFD54F";
      case .amber400 : return "#FFCA28";
      case .amber500 : return "#FFC107";
      case .amber600 : return "#FFB300";
      case .amber700 : return "#FFA000";
      case .amber800 : return "#FF8F00";
      case .amber900 : return "#FF6F00";
      case .amberA100: return "#FFE57F";
      case .amberA200: return "#FFD740";
      case .amberA400: return "#FFC400";
      case .amberA700: return "#FFAB00";

      case .orange50  : return "#FFF3E0";
      case .orange100 : return "#FFE0B2";
      case .orange200 : return "#FFCC80";
      case .orange300 : return "#FFB74D";
      case .orange400 : return "#FFA726";
      case .orange500 : return "#FF9800";
      case .orange600 : return "#FB8C00";
      case .orange700 : return "#F57C00";
      case .orange800 : return "#EF6C00";
      case .orange900 : return "#E65100";
      case .orange1000: return "#a63a00";
      case .orangeA100: return "#FFD180";
      case .orangeA200: return "#FFAB40";
      case .orangeA400: return "#FF9100";
      case .orangeA700: return "#FF6D00";
    };
  };
  
  public var color: UIColor {
    return UIColor(hexString: self.colorHexString)!;
  };
};





