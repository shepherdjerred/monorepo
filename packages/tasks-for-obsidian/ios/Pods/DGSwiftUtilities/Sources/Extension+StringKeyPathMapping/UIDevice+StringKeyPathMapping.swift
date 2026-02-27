//
//  UIDevice+StringKeyPathMapping.swift
//  
//
//  Created by Dominic Go on 12/27/23.
//

import UIKit

extension UIDevice: StringKeyPathMapping {
  public typealias KeyPathRoot = UIDevice;
  
  public static var partialKeyPathMap: Dictionary<String, PartialKeyPath<UIDevice>> = [
    "name": \.name,
    "model": \.model,
    "localizedModel": \.localizedModel,
    "systemName": \.systemName,
    "systemVersion": \.systemVersion,
    "orientation": \.orientation,
    "identifierForVendor": \.identifierForVendor,
    "isGeneratingDeviceOrientationNotifications": \.isGeneratingDeviceOrientationNotifications,
    "isBatteryMonitoringEnabled": \.isBatteryMonitoringEnabled,
    "batteryState": \.batteryState,
    "batteryLevel": \.batteryLevel,
    "isProximityMonitoringEnabled": \.isProximityMonitoringEnabled,
    "proximityState": \.proximityState,
    "isMultitaskingSupported": \.isMultitaskingSupported,
    "userInterfaceIdiom": \.userInterfaceIdiom,
  ];
};
