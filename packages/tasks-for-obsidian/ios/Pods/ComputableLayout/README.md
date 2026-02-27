# ComputableLayout

A config-based layout calculator.

![ComputaleLayoutTestPresets](./Assets/2023-08-25-ComputaleLayoutTestPresets-02.gif)

<br><br>

## Installation
### Cocoapods

`ComputableLayout` is available through [CocoaPods](https://cocoapods.org). To install it, simply add the following line to your `Podfile`:

```ruby
pod 'ComputableLayout'
```

<br>

### Swift Package Manager (SPM)

Method: #1: Via Xcode GUI:

1. File > Swift Packages > Add Package Dependency
2. Add `https://github.com/dominicstop/ComputableLayout.git`

<br>

Method: #2: Via `Package.swift`:

* Open your project's `Package.swift` file.
* Update `dependencies` in `Package.swift`, and add the following:

```swift
dependencies: [
  .package(url: "https://github.com/dominicstop/ComputableLayout.git",
  .upToNextMajor(from: "0.1.0"))
]
```

<br><br>

## Basic Usage

[🔗 Full Example](./Example/Examples/ViewControllerBasicUsage01.swift)

```swift
import UIKit
import ComputableLayout


class ViewControllerBasicUsage01: UIViewController {

  var layoutConfig = ComputableLayout(
    horizontalAlignment: .center,
    verticalAlignment: .center,
    width: .constant(100),
    height: .constant(100)
  );
  
  var layoutContext: ComputableLayoutValueContext? {
    ComputableLayoutValueContext(fromTargetViewController: self);
  };
  
  var floatingView: UIView?;

  override func viewDidLoad() {
    self.view.backgroundColor = .white;
    
    let floatingView = UIView();
    self.floatingView = floatingView;
    
    floatingView.backgroundColor = UIColor(
      hue: 0/360,
      saturation: 50/100,
      brightness: 100/100,
      alpha: 1.0
    );
  
    self.view.addSubview(floatingView);
  };
  
  override func viewDidLayoutSubviews() {
    guard let floatingView = self.floatingView,
          let layoutContext = self.layoutContext
    else { return };
    
    let computedRect =
      layoutConfig.computeRect(usingLayoutValueContext: layoutContext);
    
    floatingView.frame = computedRect;
  };
};
```

<br><br>

## Documentation

TBA

<br><br>

## Examples

TBA

<br><br>

## Misc and Contact

* 🐤 **Twitter/X**: `@GoDominic`
* 💌 **Email**: `dominicgo@dominicgo.dev`
* 🌐 **Website** [dominicgo.dev](https://dominicgo.dev)
