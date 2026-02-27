//
//  WeakElement.swift
//  RNSwiftReviewer
//
//  Created by Dominic Go on 8/15/20.
//

import UIKit


public struct WeakElement<Element: AnyObject> {
  public weak var value: Element?;
};
