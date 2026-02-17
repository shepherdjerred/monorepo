# Tab views | Apple Developer Documentation

> A tab view presents multiple mutually exclusive panes of content in the same area, which people can switch between using a tabbed control.

**Source**: [https://developer.apple.com/design/human-interface-guidelines/components/layout-and-organization/tab-views](https://developer.apple.com/design/human-interface-guidelines/components/layout-and-organization/tab-views)

---

# Tab views

A tab view presents multiple mutually exclusive panes of content in the same area, which people can switch between using a tabbed control.

![A stylized representation of a view with two labeled tabs, the first of which is selected. The image is tinted red to subtly reflect the red in the original six-color Apple logo.](https://docs-assets.developer.apple.com/published/4b2dbd07b3c6fe1d349d6db6aad5890b/components-tab-view-intro%402x.png)

## [Best practices](/design/human-interface-guidelines/tab-views#Best-practices)

**Use a tab view to present closely related areas of content.** The appearance of a tab view provides a strong visual indication of enclosure. People expect each tab to display content that is in some way similar or related to the content in the other tabs.

**Make sure the controls within a pane affect content only in the same pane.** Panes are mutually exclusive, so ensure they’re fully self-contained.

**Provide a label for each tab that describes the contents of its pane.** A good label helps people predict the contents of a pane before clicking or tapping its tab. In general, use nouns or short noun phrases for tab labels. A verb or short verb phrase may make sense in some contexts. Use title-style capitalization for tab labels.

**Avoid using a pop-up button to switch between tabs.** A tabbed control is efficient because it requires a single click or tap to make a selection, whereas a pop-up button requires two. A tabbed control also presents all choices onscreen at the same time, whereas people must click a pop-up button to see its choices. Note that a pop-up button can be a reasonable alternative in cases where there are too many panes of content to reasonably display with tabs.

**Avoid providing more than six tabs in a tab view.** Having more than six tabs can be overwhelming and create layout issues. If you need to present six or more tabs, consider another way to implement the interface. For example, you could instead present each tab as a view option in a pop-up button menu.

For developer guidance, see [`NSTabView`](/documentation/AppKit/NSTabView).

## [Anatomy](/design/human-interface-guidelines/tab-views#Anatomy)

The tabbed control appears on the top edge of the content area. You can choose to hide the control, which is appropriate for an app that switches between panes programmatically.

![An illustration of a window in which a three-tab tabbed control is centered on the top edge of the content view.](https://docs-assets.developer.apple.com/published/05bb7fbc6365c3bab10db218644756c3/tab-views-top%402x.png)

When you hide the tabbed control, the content area can be borderless, bezeled, or bordered with a line. A borderless view can be solid or transparent.

**In general, inset a tab view by leaving a margin of window-body area on all sides of a tab view.** This layout looks clean and leaves room for additional controls that aren’t directly related to the contents of the tab view. You can extend a tab view to meet the window edges, but this layout is unusual.

## [Platform considerations](/design/human-interface-guidelines/tab-views#Platform-considerations)

_Not supported in iOS, iPadOS, tvOS, or visionOS._

### [iOS, iPadOS](/design/human-interface-guidelines/tab-views#iOS-iPadOS)

For similar functionality, consider using a [segmented control](https://developer.apple.com/design/human-interface-guidelines/segmented-controls) instead.

### [watchOS](/design/human-interface-guidelines/tab-views#watchOS)

watchOS displays tab views using [page controls](https://developer.apple.com/design/human-interface-guidelines/components/presentation/page-controls). For developer guidance, see [`TabView`](/documentation/SwiftUI/TabView) and [`verticalPage`](/documentation/SwiftUI/TabViewStyle/verticalPage).

![An illustration showing the page control next to the Digital Crown on Apple Watch. The current dot is enlarged, indicating that people can scroll through the current content, as well as scroll between pages.](https://docs-assets.developer.apple.com/published/10938a94cb663210f148e0fbce431e70/tab-view-watch-vertical%402x.png)

## [Resources](/design/human-interface-guidelines/tab-views#Resources)

#### [Related](/design/human-interface-guidelines/tab-views#Related)

[Tab bars](/design/human-interface-guidelines/tab-bars)

[Segmented controls](/design/human-interface-guidelines/segmented-controls)

#### [Developer documentation](/design/human-interface-guidelines/tab-views#Developer-documentation)

[`TabView`](/documentation/SwiftUI/TabView) — SwiftUI

[`NSTabView`](/documentation/AppKit/NSTabView) — AppKit

## [Change log](/design/human-interface-guidelines/tab-views#Change-log)

| Date         | Changes                                        |
| ------------ | ---------------------------------------------- |
| June 5, 2023 | Added guidance for using tab views in watchOS. |
