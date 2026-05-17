# Color wells | Apple Developer Documentation

> A color well lets people adjust the color of text, shapes, guides, and other onscreen elements.

**Source**: [https://developer.apple.com/design/human-interface-guidelines/color-wells](https://developer.apple.com/design/human-interface-guidelines/color-wells)

---

# Color wells

A color well lets people adjust the color of text, shapes, guides, and other onscreen elements.

![A stylized representation of a color-selection popover extending down from an expanded button. The image is tinted red to subtly reflect the red in the original six-color Apple logo.](https://docs-assets.developer.apple.com/published/8ed8273449a04a1de75d9f183c19d062/components-color-well-intro%402x.png)

A color well displays a color picker when people tap or click it. This color picker can be the system-provided one or a custom interface that you design.

## [Best practices](/design/human-interface-guidelines/color-wells#Best-practices)

**Consider the system-provided color picker for a familiar experience.** Using the built-in color picker provides a consistent experience, in addition to letting people save a set of colors they can access from any app. The system-defined color picker can also help provide a familiar experience when developing apps across iOS, iPadOS, and macOS.

## [Platform considerations](/design/human-interface-guidelines/color-wells#Platform-considerations)

_No additional considerations for iOS, iPadOS, or visionOS. Not supported in tvOS or watchOS._

### [macOS](/design/human-interface-guidelines/color-wells#macOS)

When people click a color well, it receives a highlight to provide visual confirmation that it’s active. It then opens a color picker so people can choose a color. After they make a selection, the color well updates to show the new color.

Color wells also support drag and drop, so people can drag colors from one color well to another, and from the color picker to a color well.

## [Resources](/design/human-interface-guidelines/color-wells#Resources)

#### [Related](/design/human-interface-guidelines/color-wells#Related)

[Color](/design/human-interface-guidelines/color)

#### [Developer documentation](/design/human-interface-guidelines/color-wells#Developer-documentation)

[`UIColorWell`](/documentation/UIKit/UIColorWell) — UIKit

[`UIColorPickerViewController`](/documentation/UIKit/UIColorPickerViewController) — UIKit

[`NSColorWell`](/documentation/AppKit/NSColorWell) — AppKit

[Color Programming Topics](https://developer.apple.com/library/content/documentation/Cocoa/Conceptual/DrawColor/DrawColor.html)
