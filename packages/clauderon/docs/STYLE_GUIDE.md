# Clauderon Style Guide

**Version:** 1.0
**Last Updated:** 2026-01-14

A comprehensive design system and style guide for Clauderon's cross-platform interfaces: Web, Mobile (iOS/Android/macOS/Windows), and TUI (Terminal UI).

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Core Design Philosophy](#2-core-design-philosophy)
3. [Color System](#3-color-system)
4. [Typography](#4-typography)
5. [Layout & Spacing](#5-layout--spacing)
6. [Components Library](#6-components-library)
7. [Shadows & Elevation](#7-shadows--elevation)
8. [Interactive States](#8-interactive-states)
9. [Animations](#9-animations)
10. [Iconography](#10-iconography)
11. [Borders & Outlines](#11-borders--outlines)
12. [Dark Mode](#12-dark-mode)
13. [Platform-Specific Patterns](#13-platform-specific-patterns)
14. [Accessibility](#14-accessibility)
15. [Code Standards](#15-code-standards)
16. [Examples & Patterns](#16-examples--patterns)
17. [Testing & QA](#17-testing--qa)
18. [Contributing](#18-contributing)

**Appendices:**
- [Appendix A: File Reference Index](#appendix-a-file-reference-index)
- [Appendix B: Color Conversion Table](#appendix-b-color-conversion-table)
- [Appendix C: Component Parity Matrix](#appendix-c-component-parity-matrix)
- [Appendix D: Screenshot Gallery](#appendix-d-screenshot-gallery)

---

## 1. Introduction

### Purpose

This style guide establishes design consistency across Clauderon's three distinct user interfaces. It serves as the single source of truth for colors, typography, components, and interaction patterns.

### Scope

This guide covers:
- **Web Frontend**: React + Tailwind CSS + shadcn/ui
- **Mobile App**: React Native (iOS, Android, macOS, Windows)
- **TUI**: Rust + Ratatui (Terminal User Interface)

### Who Should Use This Guide

- **Designers**: Understanding Clauderon's brutalist design language
- **Frontend Developers**: Implementing web and mobile interfaces
- **Rust Developers**: Building TUI components
- **Contributors**: Maintaining design consistency in pull requests

### Quick Navigation

- **Colors**: See [Section 3](#3-color-system) for complete palette with cross-platform mapping
- **Components**: See [Section 6](#6-components-library) for button, card, badge, and input patterns
- **Platform Differences**: See [Section 13](#13-platform-specific-patterns) for platform-specific implementations

---

## 2. Core Design Philosophy

Clauderon embraces a **brutalist design philosophy** that prioritizes function, honesty, and clarity over decorative aesthetics.

### Brutalism Manifesto

> **Raw. Honest. Functional.**

Brutalist design strips away unnecessary ornamentation to reveal the fundamental structure of the interface. In Clauderon, this means:

- **Visible Structure**: Thick borders (2-4px) make interactive elements unmistakable
- **Hard Shadows**: No blur or gradients—shadows are solid and offset
- **High Contrast**: Text and backgrounds have strong distinction for readability
- **Minimal Rounding**: Border radius of 4px maximum; many elements use 0px
- **Bold Typography**: Uppercase headings with increased letter-spacing
- **Monospace Fonts**: Technical content uses monospace for clarity

### Core Design Principles

#### 1. Function Over Form

Every visual element serves a purpose. Borders aren't decorative—they define boundaries. Shadows aren't aesthetic—they indicate elevation and interactivity.

#### 2. Visible Affordances

Interactive elements are immediately recognizable:
- Buttons have chunky borders and hard shadows that "press" when clicked
- Links are underlined (2px thickness)
- Focus states have prominent 4px rings
- Status indicators use bold, saturated colors

#### 3. Information Density Without Clutter

Clauderon displays complex technical information (sessions, PRs, CI status, Claude state) in compact layouts without feeling cramped. Achieved through:
- Consistent spacing scales
- Monospace fonts for predictable character width
- Adaptive column widths in TUI
- Clear visual hierarchy

#### 4. Platform-Appropriate Implementation

While maintaining consistent design language, each platform implements patterns appropriate to its environment:
- **Web**: Hover states, modal overlays, pointer interactions
- **Mobile**: Touch targets, pull-to-refresh, keyboard handling
- **TUI**: Keyboard navigation, color-coded text, character-based layouts

### Visual Examples

**Reference Screenshots:**
- Web brutalist design: `assets/web session list.png`
- Mobile card-based layout: `assets/ios session list.jpeg`
- TUI color-coded table: `assets/tui session list.png`

---

## 3. Color System

### 3.1 Color Philosophy

Clauderon's color system prioritizes:
- **High Contrast**: All text meets WCAG AA standards
- **Status Clarity**: Consistent color-coded states across platforms
- **Dark Mode Support**: Full dark mode on web and mobile
- **Semantic Naming**: Colors named by purpose, not appearance

### 3.2 Web Colors (CSS Variables)

**Location:** `web/frontend/src/index.css:4-82`

Clauderon uses HSL color space in CSS variables for easy manipulation and dark mode switching.

#### Light Mode Palette

| Token | HSL Value | Hex Equivalent | Usage |
|-------|-----------|----------------|-------|
| `--background` | `0 0% 100%` | `#ffffff` | Page background |
| `--foreground` | `220 90% 10%` | `#0a1929` | Primary text, icon color |
| `--primary` | `220 85% 25%` | `#0c2d5e` | Primary actions, links |
| `--primary-foreground` | `0 0% 100%` | `#ffffff` | Text on primary background |
| `--secondary` | `220 15% 92%` | `#e8eaed` | Secondary backgrounds |
| `--secondary-foreground` | `220 90% 10%` | `#0a1929` | Text on secondary background |
| `--accent` | `215 100% 45%` | `#0066e6` | Interactive highlights |
| `--accent-foreground` | `0 0% 100%` | `#ffffff` | Text on accent background |
| `--destructive` | `0 75% 50%` | `#df2020` | Danger actions |
| `--destructive-foreground` | `0 0% 100%` | `#ffffff` | Text on destructive background |
| `--border` | `220 20% 80%` | `#c7cdd6` | Default borders |
| `--input` | `220 20% 80%` | `#c7cdd6` | Input field borders |
| `--ring` | `220 85% 25%` | `#0c2d5e` | Focus ring color |
| `--card` | `0 0% 98%` | `#fafafa` | Card backgrounds |
| `--muted` | `220 15% 95%` | `#f2f3f5` | Muted backgrounds |
| `--muted-foreground` | `220 20% 45%` | `#5a6b82` | Muted text |
| `--radius` | `0.25rem` | `4px` | Border radius |

#### Dark Mode Palette

| Token | HSL Value | Hex Equivalent | Usage |
|-------|-----------|----------------|-------|
| `--background` | `220 90% 8%` | `#030b16` | Page background |
| `--foreground` | `220 10% 95%` | `#eff1f3` | Primary text |
| `--primary` | `215 100% 60%` | `#3399ff` | Primary actions |
| `--primary-foreground` | `220 90% 10%` | `#0a1929` | Text on primary |
| `--secondary` | `220 50% 18%` | `#172a3d` | Secondary backgrounds |
| `--accent` | `215 100% 55%` | `#1a8cff` | Interactive highlights |
| `--border` | `220 50% 25%` | `#203651` | Default borders |
| `--ring` | `215 100% 60%` | `#3399ff` | Focus ring |

#### Status Colors

**Light Mode:**

| Token | HSL Value | Hex | Status | Usage |
|-------|-----------|-----|--------|-------|
| `--status-creating` | `220 85% 55%` | `#1966d2` | Creating/Deleting | <span style="display:inline-block;width:16px;height:16px;background:#1966d2;border:1px solid black;vertical-align:middle"></span> Session startup |
| `--status-running` | `142 71% 45%` | `#22c55e` | Running | <span style="display:inline-block;width:16px;height:16px;background:#22c55e;border:1px solid black;vertical-align:middle"></span> Active session |
| `--status-idle` | `45 93% 47%` | `#f59e0b` | Idle | <span style="display:inline-block;width:16px;height:16px;background:#f59e0b;border:1px solid black;vertical-align:middle"></span> Paused/waiting |
| `--status-completed` | `220 13% 55%` | `#7c8491` | Completed | <span style="display:inline-block;width:16px;height:16px;background:#7c8491;border:1px solid black;vertical-align:middle"></span> Finished session |
| `--status-failed` | `0 72% 51%` | `#dc2626` | Failed | <span style="display:inline-block;width:16px;height:16px;background:#dc2626;border:1px solid black;vertical-align:middle"></span> Error state |
| `--status-archived` | `220 13% 69%` | `#9ba3b0` | Archived | <span style="display:inline-block;width:16px;height:16px;background:#9ba3b0;border:1px solid black;vertical-align:middle"></span> Archived session |

**Dark Mode:** Status colors are increased in lightness by 10% for better visibility against dark backgrounds.

**Code Example:**

```css
/* web/frontend/src/index.css:36-43 */
:root {
  --status-creating: 220 85% 55%;
  --status-running: 142 71% 45%;
  --status-idle: 45 93% 47%;
  --status-completed: 220 13% 55%;
  --status-failed: 0 72% 51%;
  --status-archived: 220 13% 69%;
}

.dark {
  --status-creating: 220 85% 65%;
  --status-running: 142 71% 55%;
  --status-idle: 45 93% 57%;
  /* ... */
}
```

**Usage in Tailwind:**

```tsx
// Accessing status colors
<div className="bg-status-running" />
<p className="text-status-failed">Error occurred</p>
```

### 3.3 Mobile Colors (TypeScript)

**Location:** `mobile/src/styles/colors.ts:1-38`

Mobile uses hex colors for React Native StyleSheet compatibility.

```typescript
export const colors = {
  // Primary colors
  primary: "#1e40af",        // Blue 800 → maps to --primary (light)
  primaryDark: "#1e3a8a",    // Blue 900
  primaryLight: "#3b82f6",   // Blue 500

  // Background colors
  background: "#f5f5f5",     // Gray 100 → maps to lighter variant
  backgroundDark: "#0a0f1e", // Very dark blue → maps to --background (dark)
  surface: "#ffffff",        // White
  surfaceDark: "#1e293b",    // Slate 800

  // Text colors
  text: "#1f2937",           // Gray 800
  textLight: "#6b7280",      // Gray 500
  textDark: "#111827",       // Gray 900
  textWhite: "#ffffff",

  // Border colors (brutalist)
  border: "#000000",         // Pure black for maximum contrast
  borderLight: "#e5e7eb",    // Gray 200

  // Status colors
  success: "#22c55e",        // Green 500
  error: "#ef4444",          // Red 500
  warning: "#f59e0b",        // Amber 500
  info: "#3b82f6",           // Blue 500

  // Session status colors
  running: "#22c55e",        // Maps to --status-running
  idle: "#f59e0b",           // Maps to --status-idle
  completed: "#3b82f6",      // Maps to --status-completed
  failed: "#ef4444",         // Maps to --status-failed
  archived: "#6b7280",       // Maps to --status-archived
};
```

**Color Conversion:**

| Web Variable | Mobile Export | RGB | Notes |
|--------------|---------------|-----|-------|
| `--primary` (light) | `primary` | `rgb(30, 64, 175)` | Exact match |
| `--status-running` | `running` | `rgb(34, 197, 94)` | Exact match |
| `--border` | `border` | `rgb(0, 0, 0)` | Pure black (brutalist choice) |

### 3.4 TUI Colors (Ratatui)

**Location:** `src/tui/components/session_list.rs:282-290`, `src/tui/ui.rs`

TUI uses Ratatui's `Color` enum with terminal-compatible colors.

```rust
use ratatui::style::Color;

// Status color mapping
match session.status {
    SessionStatus::Creating => Color::Yellow,
    SessionStatus::Running => Color::Green,
    SessionStatus::Idle => Color::Blue,
    SessionStatus::Completed => Color::Cyan,
    SessionStatus::Failed => Color::Red,
    SessionStatus::Archived => Color::DarkGray,
}
```

**TUI Color Palette:**

| Ratatui Color | Approximate Hex | Usage Context |
|---------------|-----------------|---------------|
| `Color::Cyan` | `#00ffff` | Primary borders, help text, completed status |
| `Color::Green` | `#00ff00` | Running status, attached mode indicator, success |
| `Color::Yellow` | `#ffff00` | Creating/Idle status, warnings, scroll indicators |
| `Color::Blue` | `#0000ff` | Idle status alternative |
| `Color::Red` | `#ff0000` | Failed status, errors, delete confirmations |
| `Color::DarkGray` | `#808080` | Archived status, muted text, inactive borders |
| `Color::Black` | `#000000` | Scroll indicator background |

**Note:** Actual rendering depends on terminal color scheme. These are standard terminal colors.

### 3.5 Status Color Cross-Platform Mapping

| Status | Web (Light) | Web (Dark) | Mobile | TUI | Semantic Meaning |
|--------|-------------|------------|--------|-----|------------------|
| **Creating** | `hsl(220 85% 55%)` Blue | `hsl(220 85% 65%)` | `#3b82f6` Info Blue | `Color::Yellow` | Session is being created |
| **Running** | `hsl(142 71% 45%)` Green | `hsl(142 71% 55%)` | `#22c55e` Green | `Color::Green` | Active, healthy state |
| **Idle** | `hsl(45 93% 47%)` Amber | `hsl(45 93% 57%)` | `#f59e0b` Amber | `Color::Blue` | Waiting, not active |
| **Completed** | `hsl(220 13% 55%)` Gray | `hsl(220 13% 65%)` | `#3b82f6` Blue | `Color::Cyan` | Successfully finished |
| **Failed** | `hsl(0 72% 51%)` Red | `hsl(0 72% 61%)` | `#ef4444` Red | `Color::Red` | Error or failure state |
| **Archived** | `hsl(220 13% 69%)` Light Gray | `hsl(220 13% 50%)` | `#6b7280` Gray | `Color::DarkGray` | Inactive, stored |

**Note:** TUI differs slightly due to terminal color limitations. Yellow is used for Creating (more attention-grabbing than blue in terminals).

---

## 4. Typography

### 4.1 Font Families

#### Web

**Location:** `web/frontend/tailwind.config.js:62-65`

```javascript
fontFamily: {
  mono: ['Berkeley Mono', 'Menlo', 'Monaco', 'monospace'],
  sans: ['system-ui', 'sans-serif'],
}
```

**Berkeley Mono** is the signature monospace font, loaded from OpenType files:
- **Location:** `web/frontend/src/assets/fonts/BerkeleyMono-*.otf`
- **Weights:** 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)
- **Usage:** Code blocks, file paths, session names, technical identifiers

**System UI** is used for body text for optimal performance and platform consistency.

#### Mobile

**Location:** `mobile/src/styles/typography.ts:8-19`

```typescript
fontFamily: {
  regular: Platform.select({
    ios: "System",
    android: "Roboto",
    default: "System",
  }),
  mono: Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  }),
}
```

Platform-native fonts ensure optimal rendering:
- **iOS**: San Francisco (System) + Menlo
- **Android**: Roboto + Android Monospace

#### TUI

TUI uses the terminal's default monospace font. No custom font loading is possible.

### 4.2 Type Scale

#### Web Type Scale (Tailwind)

| Level | Class | Font Size | Line Height | Usage |
|-------|-------|-----------|-------------|-------|
| **Display** | `text-4xl` | 36px (2.25rem) | 40px (2.5rem) | Large headings |
| **H1** | `text-3xl` | 30px (1.875rem) | 36px (2.25rem) | Page titles |
| **H2** | `text-2xl` | 24px (1.5rem) | 32px (2rem) | Section headers |
| **H3** | `text-xl` | 20px (1.25rem) | 28px (1.75rem) | Subsection headers |
| **Large** | `text-lg` | 18px (1.125rem) | 28px (1.75rem) | Emphasized body |
| **Body** | `text-base` | 16px (1rem) | 24px (1.5rem) | Default text |
| **Small** | `text-sm` | 14px (0.875rem) | 20px (1.25rem) | Secondary text |
| **Tiny** | `text-xs` | 12px (0.75rem) | 16px (1rem) | Labels, captions |

**Monospace Text:** Use `.font-mono` class with size classes: `text-sm font-mono`

#### Mobile Type Scale

**Location:** `mobile/src/styles/typography.ts:22-31`

```typescript
fontSize: {
  xs: 12,      // Labels, metadata
  sm: 14,      // Secondary text, code
  base: 16,    // Body text (default)
  lg: 18,      // Emphasized text
  xl: 20,      // Subheadings
  "2xl": 24,   // Section headings
  "3xl": 30,   // Screen titles
  "4xl": 36,   // Large display
}
```

**Font Weights:**

```typescript
fontWeight: {
  normal: "400",    // Body text
  medium: "500",    // Emphasized text
  semibold: "600",  // Subheadings
  bold: "700",      // Headings, buttons
  extrabold: "800", // Display text
}
```

#### TUI Typography

TUI has a single font size (terminal default, typically 12-14px equivalent). Emphasis achieved through:
- **Bold**: `Modifier::BOLD`
- **Underline**: `Modifier::UNDERLINED`
- **Color**: Foreground color changes
- **Uppercase**: Text transformation in Rust

### 4.3 Text Styles

#### Heading Styles

**Web:**

```tsx
// H1 - Page title
<h1 className="text-3xl font-extrabold uppercase tracking-wider">
  Sessions
</h1>

// H2 - Section header
<h2 className="text-2xl font-bold uppercase">
  Create New Session
</h2>

// H3 - Subsection
<h3 className="text-xl font-bold">
  Configuration
</h3>
```

**Mobile:**

**Location:** `mobile/src/styles/common.ts:36-55`

```typescript
heading1: {
  fontSize: typography.fontSize["3xl"],    // 30
  fontWeight: typography.fontWeight.extrabold,  // 800
  color: colors.textDark,
  textTransform: "uppercase",
  letterSpacing: 1,
},

heading2: {
  fontSize: typography.fontSize["2xl"],    // 24
  fontWeight: typography.fontWeight.bold,  // 700
  color: colors.textDark,
  textTransform: "uppercase",
},

heading3: {
  fontSize: typography.fontSize.xl,        // 20
  fontWeight: typography.fontWeight.bold,  // 700
  color: colors.textDark,
},
```

**TUI:**

```rust
// Bold uppercase heading
Span::styled("SESSIONS", Style::default().add_modifier(Modifier::BOLD))
```

#### Body Text

**Web:**

```tsx
<p className="text-base text-foreground">
  Regular body text with standard line height.
</p>

<p className="text-sm text-muted-foreground">
  Secondary descriptive text in muted color.
</p>
```

**Mobile:**

```typescript
bodyText: {
  fontSize: typography.fontSize.base,        // 16
  fontWeight: typography.fontWeight.normal,  // 400
  color: colors.text,
  lineHeight: typography.fontSize.base * typography.lineHeight.normal, // 24
}
```

#### Monospace Text

**Web:**

```tsx
<code className="font-mono text-sm bg-muted px-1 py-0.5 rounded">
  /workspace/project
</code>

<pre className="font-mono text-xs bg-muted p-4 rounded border-2">
  docker run -it clauderon
</pre>
```

**Mobile:**

**Location:** `mobile/src/styles/common.ts:64-68`

```typescript
monoText: {
  fontFamily: typography.fontFamily.mono,
  fontSize: typography.fontSize.sm,
  color: colors.text,
}
```

**Usage:**

```tsx
<Text style={commonStyles.monoText}>
  /path/to/repository
</Text>
```

### 4.4 Typography Do's and Don'ts

**DO:**
- ✅ Use **uppercase** for H1 and H2 headings with increased letter-spacing
- ✅ Use **sentence case** for body text and H3+ headings
- ✅ Use **monospace** for code, file paths, URLs, session IDs, backend types
- ✅ Apply **bold weight** (700+) to headings and buttons
- ✅ Use consistent **line height** (1.5x for body, 1.25x for headings)

**DON'T:**
- ❌ Mix case styles in headings (no "Title Case" in H1/H2)
- ❌ Use monospace for prose or paragraph text
- ❌ Use ultra-thin weights (100-300) — minimum is 400 (normal)
- ❌ Apply letter-spacing to body text
- ❌ Use decorative or script fonts

---

## 5. Layout & Spacing

### 5.1 Spacing Scale

Clauderon uses a consistent **4px base unit** spacing system across platforms.

#### Web Spacing (Tailwind)

Tailwind's default spacing scale (0.25rem = 4px base):

| Class | Value | Pixels | Usage |
|-------|-------|--------|-------|
| `space-1` | 0.25rem | 4px | Tight spacing |
| `space-2` | 0.5rem | 8px | Small gaps |
| `space-3` | 0.75rem | 12px | Medium gaps |
| `space-4` | 1rem | 16px | Standard spacing (default) |
| `space-6` | 1.5rem | 24px | Large spacing |
| `space-8` | 2rem | 32px | Section spacing |
| `space-12` | 3rem | 48px | Major section breaks |

**Common patterns:**

```tsx
// Component spacing
<div className="p-4">       {/* 16px padding */}
<div className="gap-2">     {/* 8px gap between flex/grid items */}
<div className="mb-3">      {/* 12px bottom margin */}
```

#### Mobile Spacing

Mobile uses raw pixel values following the same 4px scale:

```typescript
{
  padding: 16,           // Standard padding
  marginBottom: 12,      // Medium margin
  gap: 8,                // Small gap
  marginHorizontal: 16,  // Side margins
}
```

**Location:** `mobile/src/styles/common.ts:16-33`

```typescript
card: {
  padding: 16,          // 4 × 4px
  marginBottom: 12,     // 3 × 4px
  // ...
}
```

#### TUI Spacing

TUI uses character-based spacing. Each cell is one character width:

```rust
// Add padding with spaces or Layout constraints
Layout::vertical([
    Constraint::Length(1),  // 1 line padding
    Constraint::Min(0),     // Content
    Constraint::Length(1),  // 1 line padding
])
```

### 5.2 Container Patterns

#### Web Containers

**Max Widths:**

```tsx
// Chat interface - constrained width for readability
<div className="max-w-5xl mx-auto">  {/* 1280px max */}

// Full-width grid
<div className="container mx-auto px-4">  {/* Responsive with 2rem padding */}

// Session card grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
```

**Location:** `web/frontend/tailwind.config.js:9-12`

```javascript
container: {
  center: true,
  padding: "2rem",  // 32px horizontal padding
}
```

#### Mobile Containers

**Location:** `mobile/src/styles/common.ts:10-13`

```typescript
container: {
  flex: 1,
  backgroundColor: colors.background,
}
```

**Card Horizontal Margins:**

```typescript
// Consistent side margins
marginHorizontal: 16,  // 16px from screen edges
```

#### TUI Layout

**Location:** `src/tui/ui.rs:15-21`

```rust
let main_chunks = Layout::vertical([
    Constraint::Min(0),      // Main content expands
    Constraint::Length(1),   // Status bar fixed at 1 line
]).split(frame.area());
```

**Adaptive Column Layout:**

```rust
// session_list.rs calculates optimal column widths
ColumnWidths::calculate(sessions, available_width)
```

### 5.3 Card Layouts

#### Web Card

**Location:** `web/frontend/src/components/SessionCard.tsx:32`

```tsx
<Card className="border-2 hover:shadow-[4px_4px_0_hsl(var(--foreground))] transition-all">
  <CardHeader className="pb-3">
    {/* Header content: status dot, title, badge */}
  </CardHeader>
  <CardContent>
    {/* Body: description, status indicators, metadata */}
  </CardContent>
  <CardFooter>
    {/* Actions: icon buttons */}
  </CardFooter>
</Card>
```

**Spacing:**
- `CardHeader`: `pb-3` (12px bottom padding)
- Default card padding: 24px (from shadcn/ui)
- Gap between elements: 8-12px

#### Mobile Card

**Location:** `mobile/src/styles/common.ts:16-33`, `mobile/src/components/SessionCard.tsx:173-175`

```typescript
card: {
  backgroundColor: colors.surface,
  borderWidth: 3,              // Brutalist thick border
  borderColor: colors.border,  // Pure black
  padding: 16,
  marginBottom: 12,
  marginHorizontal: 16,        // Applied in component
  // Platform-specific shadows...
}
```

**Internal Spacing:**

```typescript
header: {
  marginBottom: 8,
},
statusIndicators: {
  marginBottom: 8,
  gap: 4,
}
```

### 5.4 Grid & List Layouts

#### Web Grid

```tsx
// Session list grid (responsive)
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
  {sessions.map(session => <SessionCard key={session.id} ... />)}
</div>
```

#### Mobile List

```tsx
<FlatList
  data={sessions}
  renderItem={({ item }) => <SessionCard session={item} ... />}
  contentContainerStyle={{ paddingVertical: 16 }}
  ItemSeparatorComponent={() => <View style={{ height: 0 }} />}
  // Cards have marginBottom built-in
/>
```

#### TUI Table

```rust
// Adaptive column widths with fixed indicators
let widths = ColumnWidths::calculate(sessions, width);

// Layout: [Prefix] [Name] [Repo] [Status] [Backend] [Branch] [◎] [CI] [⚠]
//         4ch      15-40  12-30  8-15     10-15     10-25    2   2   2
```

---

## 6. Components Library

### 6.1 Buttons

#### Web Button Component

**Location:** `web/frontend/src/components/ui/button.tsx:7-36`

The Button component uses `class-variance-authority` for variant management.

**Base Styles:**

```typescript
const buttonVariants = cva(
  "cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border-2",
  // ...
)
```

**Variants:**

1. **default** - Primary action button

```tsx
<Button variant="default">Create Session</Button>
```

```css
bg-primary text-primary-foreground hover:bg-primary/90 border-primary
```

2. **brutalist** - Special variant with hard shadow (recommended for primary CTAs)

```tsx
<Button variant="brutalist">Submit</Button>
```

```css
bg-primary text-primary-foreground border-foreground
shadow-[4px_4px_0_hsl(var(--foreground))]
hover:shadow-[2px_2px_0_hsl(var(--foreground))]
active:shadow-none active:translate-x-1 active:translate-y-1
```

**Effect:** Button appears to "press into" the page when clicked.

3. **outline** - Secondary action

```tsx
<Button variant="outline">Cancel</Button>
```

```css
border-border bg-background hover:bg-accent hover:text-accent-foreground
```

4. **ghost** - Minimal button for icons

```tsx
<Button variant="ghost" size="icon">
  <Terminal className="w-4 h-4" />
</Button>
```

5. **destructive** - Danger actions

```tsx
<Button variant="destructive">Delete</Button>
```

```css
bg-destructive text-destructive-foreground hover:bg-destructive/90
```

**Sizes:**

```tsx
<Button size="sm">Small</Button>      // h-9 px-3
<Button size="default">Default</Button>  // h-10 px-4
<Button size="lg">Large</Button>      // h-11 px-8
<Button size="icon">Icon</Button>     // h-10 w-10
```

#### Mobile Button Styles

**Location:** `mobile/src/styles/common.ts:71-96`

```typescript
button: {
  backgroundColor: colors.primary,
  borderWidth: 3,                    // Thicker than web (brutalist)
  borderColor: colors.border,        // Pure black
  paddingVertical: 12,
  paddingHorizontal: 20,
  ...Platform.select({
    ios: {
      shadowColor: colors.border,
      shadowOffset: { width: 3, height: 3 },
      shadowOpacity: 1,
      shadowRadius: 0,               // Hard shadow!
    },
    android: {
      elevation: 3,
    },
  }),
},

buttonText: {
  fontSize: typography.fontSize.base,
  fontWeight: typography.fontWeight.bold,
  color: colors.textWhite,
  textTransform: "uppercase",
  letterSpacing: 0.5,
},
```

**Usage:**

```tsx
<TouchableOpacity style={commonStyles.button} onPress={handlePress}>
  <Text style={commonStyles.buttonText}>Create</Text>
</TouchableOpacity>
```

#### TUI Buttons (List Selection)

**Location:** `src/tui/components/session_list.rs:434-445`

TUI doesn't have traditional buttons. Instead, lists with highlight styles:

```rust
List::new(items)
  .highlight_style(
    Style::default()
      .bg(Color::DarkGray)
      .add_modifier(Modifier::BOLD),
  )
  .highlight_symbol("▶ ");
```

**Effect:** Selected item has dark gray background, bold text, and arrow prefix.

#### Button Do's and Don'ts

**DO:**
- ✅ Use `brutalist` variant for primary CTAs on web (Create, Submit, Confirm)
- ✅ Include clear text labels; avoid icon-only buttons without tooltips
- ✅ Apply uppercase transform to button text
- ✅ Use 3px borders on mobile for consistency
- ✅ Ensure minimum 44×44 point touch target on mobile

**DON'T:**
- ❌ Mix button variants within the same action group (use consistent style)
- ❌ Use gradient backgrounds (anti-brutalist)
- ❌ Create buttons smaller than 44×44 points on mobile
- ❌ Use soft shadows or border-radius > 4px

---

### 6.2 Cards

Cards display session information in a structured, scannable format.

#### Web SessionCard

**Location:** `web/frontend/src/components/SessionCard.tsx:31-42`

**Structure:**

```tsx
<Card className="border-2 hover:shadow-[4px_4px_0_hsl(var(--foreground))] transition-all">
  <CardHeader className="pb-3">
    <div className="flex items-center gap-2">
      {/* Status dot: 4×4 square with status color */}
      <div className={`w-4 h-4 border-2 border-foreground ${statusColor}`} />

      {/* Session title */}
      <h3 className="font-bold text-lg flex-1">{session.title}</h3>

      {/* Backend badge */}
      <Badge variant="outline" className="border-2 font-mono text-xs">
        {session.backend}
      </Badge>
    </div>
  </CardHeader>

  <CardContent>
    {/* Description or initial prompt */}
    <p className="text-sm text-muted-foreground mb-3">...</p>

    {/* Status indicators: PR, Claude, conflicts */}
    <div className="flex flex-col gap-1 mb-3">...</div>

    {/* Metadata: timestamp, branch, access mode */}
    <div className="flex items-center gap-4 text-xs">...</div>
  </CardContent>

  <CardFooter>
    {/* Action buttons: Terminal, Edit, Archive, Delete */}
  </CardFooter>
</Card>
```

**Key Features:**
- **Status Dot**: 4×4 pixel square with 2px border, filled with status color
- **Hover Effect**: `shadow-[4px_4px_0_hsl(var(--foreground))]` on hover
- **Border**: Always 2px solid
- **Badge**: Monospace font for backend type (Docker, Kubernetes)

**Visual Reference:** `assets/web session list.png`

#### Mobile SessionCard

**Location:** `mobile/src/components/SessionCard.tsx:18-80`

**Structure:**

```tsx
<TouchableOpacity
  style={[commonStyles.card, styles.card]}
  onPress={onPress}
  activeOpacity={0.7}
>
  <View style={styles.header}>
    {/* Session name */}
    <Text style={styles.name} numberOfLines={1}>
      {session.name}
    </Text>

    {/* Status badge (integrated into header) */}
    <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
      <Text style={styles.statusText}>{session.status}</Text>
    </View>
  </View>

  {/* Repository path */}
  <Text style={styles.repoPath} numberOfLines={1}>
    {session.repo_path}
  </Text>

  {/* Status indicators */}
  <View style={styles.statusIndicators}>
    {/* PR status, Claude status, merge conflict */}
  </View>

  {/* Timestamp */}
  <Text style={styles.timestamp}>
    {formatRelativeTime(session.created_at)}
  </Text>
</TouchableOpacity>
```

**Key Features:**
- **Entire card touchable**: Single tap to open chat
- **Status badge**: Colored background with white text (unlike web's colored dot)
- **3px border**: Thicker than web for mobile emphasis
- **Platform shadows**: iOS hard shadow, Android elevation

**Visual Reference:** `assets/ios session list.jpeg`

#### TUI Session List Item

**Location:** `src/tui/components/session_list.rs:278-432`

**Structure (ASCII representation):**

```
[▶ ] [SessionName_______] [repo-name] [Running] [Docker] [main    ] [◎] [●] [ ]
 2ch  15-40ch             12-30ch     8-15ch    10-15ch   10-25ch   2ch 2ch 2ch
```

**Columns:**
1. **Prefix** (4ch): Spinner or selection arrow
2. **Name** (15-40ch): Session name, truncated with ellipsis
3. **Repository** (12-30ch): Repo directory name
4. **Status** (8-15ch): Color-coded status text
5. **Backend** (10-15ch): Docker/K8s
6. **Branch/PR** (10-25ch): Git branch or "PR"
7. **Claude** (2ch): `◎` if Claude is active
8. **CI** (2ch): `●` (colored by CI status)
9. **Conflict** (2ch): `⚠` if merge conflict

**Adaptive Width:** Columns shrink proportionally if terminal is narrow, respecting minimum widths.

**Key Features:**
- **Unicode-aware truncation**: `truncate_with_ellipsis` handles multi-byte characters
- **Animated spinner**: `⠋⠙⠹⠸` rotates for active operations
- **Color-coded status**: Text color matches status (Green/Yellow/Red/etc.)

**Visual Reference:** `assets/tui session list.png`

---

### 6.3 Badges

Badges display small pieces of metadata (backend type, status, etc.).

#### Web Badge

**Location:** `web/frontend/src/components/ui/badge.tsx`

```tsx
<Badge variant="outline" className="border-2 font-mono text-xs">
  Docker
</Badge>
```

**Variants:**
- `default`: Filled with primary color
- `secondary`: Filled with secondary color
- `destructive`: Filled with destructive color
- `outline`: Border only, transparent background

**Custom styling:**

```tsx
<Badge variant="outline" className="border-2 font-mono text-xs uppercase">
  {session.backend}
</Badge>
```

#### Mobile Badge

**Location:** `mobile/src/styles/common.ts:110-123`

```typescript
badge: {
  paddingVertical: 4,
  paddingHorizontal: 8,
  borderWidth: 2,
  borderColor: colors.border,
  backgroundColor: colors.surface,
},

badgeText: {
  fontSize: typography.fontSize.xs,    // 12
  fontWeight: typography.fontWeight.bold,
  color: colors.textDark,
  textTransform: "uppercase",
},
```

**Usage:**

```tsx
<View style={commonStyles.badge}>
  <Text style={commonStyles.badgeText}>Docker</Text>
</View>
```

#### TUI Badge (Inline Text Spans)

TUI doesn't have separate badge components. Instead, color-coded text spans:

```rust
Span::styled(
    format!("{:?}", session.backend),
    Style::default().fg(Color::Cyan)
)
```

---

### 6.4 Inputs

#### Web Input

**Location:** `web/frontend/src/components/ui/input.tsx` + `web/frontend/src/index.css:96-98`

**Base Styles:**

```css
/* index.css:96-98 */
button, input, select, textarea {
  border-width: 2px;
}
```

**Usage:**

```tsx
<Input
  type="text"
  placeholder="Session name"
  className="border-2"
/>
```

**Styles:**
- Border: 2px solid `hsl(var(--input))`
- Background: White (light) / Dark gray (dark)
- Focus: 4px ring `hsl(var(--ring))`

#### Mobile Input

**Location:** `mobile/src/styles/common.ts:99-107`

```typescript
input: {
  backgroundColor: colors.surface,
  borderWidth: 2,
  borderColor: colors.border,
  padding: 12,
  fontSize: typography.fontSize.base,
  fontFamily: typography.fontFamily.regular,
  color: colors.text,
}
```

**Usage:**

```tsx
<TextInput
  style={commonStyles.input}
  placeholder="Enter daemon URL"
  placeholderTextColor={colors.textLight}
/>
```

#### TUI Input

**Location:** `src/tui/text_input.rs`

Custom TextInput component with:
- Cursor rendering
- Visual selection highlight
- Character-by-character editing

```rust
let input_widget = Paragraph::new(text)
    .style(Style::default().fg(Color::White))
    .block(Block::default().borders(Borders::ALL).border_style(border_style));
```

---

### 6.5 Status Indicators

Status indicators show session state, PR checks, CI status, and Claude activity.

#### Web Status Indicators

**Location:** `web/frontend/src/components/SessionCard.tsx:54-96`

**Types:**

1. **PR Status with CI Checks**

```tsx
<a href={session.pr_url} className="text-blue-500 hover:underline font-mono">
  PR #{pr_number}
</a>
<span className={getCheckStatusColor(session.pr_check_status)}>
  {getCheckStatusIcon(session.pr_check_status)}
  <span className="font-mono">{session.pr_check_status}</span>
</span>
```

**Icons:**
- `<CheckCircle2 />` (green): Passing/Mergeable/Merged
- `<XCircle />` (red): Failing
- `<Clock />` (yellow): Pending

2. **Claude Working Status**

```tsx
<div className={getClaudeStatusColor(session.claude_status)}>
  {getClaudeStatusIcon(session.claude_status)}
  <span className="font-mono">{getClaudeStatusText(session.claude_status)}</span>
  <span className="text-muted-foreground">({timeAgo})</span>
</div>
```

**Icons:**
- `<Loader2 className="animate-spin" />` (blue): Working
- `<User />` (purple): WaitingApproval
- `<Circle />` (gray): Idle

3. **Merge Conflict Warning**

```tsx
<div className="text-red-500">
  <AlertTriangle className="w-3 h-3" />
  <span className="font-mono font-semibold">Merge conflict with main</span>
</div>
```

#### Mobile Status Indicators

**Location:** `mobile/src/components/SessionCard.tsx:39-74`

**Types:**

1. **PR Check Status**

```tsx
<Text style={getCheckStatusStyle(status)}>
  {getCheckStatusSymbol(status)}  {/* ✓ ✗ ⏱ */}
</Text>
<Text style={getCheckStatusTextStyle(status)}>
  {status}
</Text>
```

**Symbols:**
- `✓` (green): Passing/Mergeable
- `✗` (red): Failing
- `⏱` (yellow): Pending

2. **Claude Status**

```tsx
<Text style={styles.statusLabel}>Claude: </Text>
<Text style={getClaudeStatusTextStyle(session.claude_status)}>
  {getClaudeStatusText(session.claude_status)}
</Text>
```

3. **Merge Conflict**

```tsx
<Text style={styles.conflictWarning}>⚠ Merge conflict with main</Text>
```

#### TUI Status Indicators

**Location:** `src/tui/components/session_list.rs:302-342`

**Symbols:**

```rust
// Claude Working Status
match session.claude_status {
    ClaudeWorkingStatus::Working => {
        let spinner = match app.spinner_tick % 4 {
            0 => "⠋", 1 => "⠙", 2 => "⠹", _ => "⠸",
        };
        Span::styled(spinner, Style::default().fg(Color::Green))
    },
    ClaudeWorkingStatus::WaitingApproval => {
        Span::styled("⏸", Style::default().fg(Color::Yellow))
    },
    ClaudeWorkingStatus::WaitingInput => {
        Span::styled("⌨", Style::default().fg(Color::Cyan))
    },
    ClaudeWorkingStatus::Idle => {
        Span::styled("○", Style::default().fg(Color::DarkGray))
    },
}

// CI Status
match check_status {
    CheckStatus::Passing | CheckStatus::Mergeable => {
        Span::styled("●", Style::default().fg(Color::Green))
    },
    CheckStatus::Failing => {
        Span::styled("●", Style::default().fg(Color::Red))
    },
    CheckStatus::Pending => {
        Span::styled("○", Style::default().fg(Color::Yellow))
    },
}

// Merge Conflict
if session.merge_conflict {
    Span::styled("⚠", Style::default().fg(Color::Red))
}
```

**Indicators:**
- `⠋⠙⠹⠸` (spinning, green): Claude Working
- `⏸` (yellow): Waiting for approval
- `⌨` (cyan): Waiting for input
- `○` (gray): Idle
- `●` (green/red): CI status
- `○` (yellow): CI pending
- `⚠` (red): Merge conflict

---

## 7. Shadows & Elevation

Clauderon uses **hard, offset shadows** (no blur) to create brutalist elevation effects.

### 7.1 Web Shadows

**Philosophy:** Shadows are solid blocks of color, offset horizontally and vertically with no blur radius.

#### Brutalist Button Shadow

**Location:** `web/frontend/src/components/ui/button.tsx:22`

```css
shadow-[4px_4px_0_hsl(var(--foreground))]
hover:shadow-[2px_2px_0_hsl(var(--foreground))]
active:shadow-none
active:translate-x-1
active:translate-y-1
```

**Effect:**
1. **Default**: 4px offset shadow to the right and down
2. **Hover**: Shadow reduces to 2px (button "raises" slightly)
3. **Active**: Shadow disappears, button translates 1px right and down (button "presses")

#### Card Shadow

**Location:** `web/frontend/src/index.css:145-149`

```css
.card-brutalist {
  box-shadow:
    4px 4px 0 hsl(var(--foreground)),
    8px 8px 0 hsl(var(--muted));
}
```

**Effect:** Double-layer shadow for extra depth (4px + 8px offset).

#### SessionCard Hover Shadow

**Location:** `web/frontend/src/components/SessionCard.tsx:32`

```tsx
className="border-2 hover:shadow-[4px_4px_0_hsl(var(--foreground))] transition-all"
```

**Effect:** Shadow appears on hover (0 → 4px offset).

#### Chat Modal Shadow

**Location:** `web/frontend/src/components/ChatInterface.tsx:74`

```typescript
boxShadow: '12px 12px 0 hsl(220, 85%, 25%), 24px 24px 0 hsl(220, 90%, 10%)'
```

**Effect:** Large double-layer shadow for prominent modal overlay.

### 7.2 Mobile Shadows

**Platform Differences:**
- **iOS**: Custom shadowOffset/shadowOpacity (hard shadow with shadowRadius: 0)
- **Android**: Material elevation (soft shadow)

#### iOS Hard Shadow

**Location:** `mobile/src/styles/common.ts:22-28`

```typescript
...Platform.select({
  ios: {
    shadowColor: colors.border,        // Black
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,                   // No blur = hard shadow
  },
})
```

**Effect:** 4×4 pixel hard shadow (brutalist) on iOS.

#### Android Elevation

```typescript
android: {
  elevation: 4,  // Material elevation (soft shadow)
}
```

**Note:** Android doesn't support hard shadows natively. Elevation provides a reasonable approximation.

#### Button Shadow

**Location:** `mobile/src/styles/common.ts:77-87`

```typescript
button: {
  // ...
  ...Platform.select({
    ios: {
      shadowColor: colors.border,
      shadowOffset: { width: 3, height: 3 },
      shadowOpacity: 1,
      shadowRadius: 0,
    },
    android: {
      elevation: 3,
    },
  }),
}
```

**Effect:** Slightly smaller shadow (3px) for buttons than cards (4px).

### 7.3 TUI "Shadows"

TUI cannot render true shadows. Instead, use:
- **Bold text** for emphasis
- **Background colors** for elevation (e.g., DarkGray background on selected items)
- **Border styles** (single, double, thick)

```rust
// Selected item has "elevated" appearance via background
.highlight_style(
    Style::default()
        .bg(Color::DarkGray)
        .add_modifier(Modifier::BOLD)
)
```

### 7.4 Shadow Do's and Don'ts

**DO:**
- ✅ Use **hard shadows** (no blur) on web
- ✅ Use **black** shadows (`hsl(var(--foreground))` or `colors.border`)
- ✅ Use **consistent offsets** (4px for cards, 3px for buttons)
- ✅ Animate shadow on **hover/press** for interactive feedback
- ✅ Use **shadowRadius: 0** on iOS for hard effect

**DON'T:**
- ❌ Use soft shadows (blur radius > 0) on web or iOS
- ❌ Use colored shadows (unless dark mode adjustments)
- ❌ Mix shadow styles within the same component
- ❌ Use shadows larger than 12px offset (becomes unwieldy)

---

## 8. Interactive States

### 8.1 Web Interactive States

#### Focus State

**Location:** `web/frontend/src/index.css:120-123`

```css
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px hsl(var(--ring)), 0 0 0 6px hsl(var(--background));
}
```

**Effect:** Chunky 4px ring with 2px background gap for maximum visibility (brutalist affordance).

**Visual:** Ring color is primary blue, creating a clear focus indicator.

#### Hover States

**Buttons:**

```tsx
// default variant
hover:bg-primary/90  // 10% lighter

// brutalist variant
hover:shadow-[2px_2px_0_hsl(var(--foreground))]  // Shadow shrinks

// ghost variant
hover:bg-accent hover:text-accent-foreground  // Background appears
```

**Cards:**

```tsx
hover:shadow-[4px_4px_0_hsl(var(--foreground))]  // Shadow appears
```

**Links:**

**Location:** `web/frontend/src/index.css:100-112`

```css
a {
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
  text-decoration-color: hsl(var(--primary));
  transition: color 200ms, text-decoration-color 200ms;
}

a:hover {
  text-decoration-color: hsl(var(--accent));
  color: hsl(var(--accent));
}
```

**Effect:** Underline color and text color change to accent blue.

**Icon Buttons:**

```tsx
<Button variant="ghost" size="icon" className="hover:scale-110 hover:shadow-md">
  <Terminal className="w-4 h-4" />
</Button>
```

#### Active State

**Brutalist Button:**

```css
active:shadow-none
active:translate-x-1
active:translate-y-1
```

**Effect:** Button "presses into" the page by translating to shadow offset position.

**Regular Buttons:**

```tsx
active:scale-95  // Slight shrink on press
```

#### Disabled State

**Location:** `web/frontend/src/components/ui/button.tsx:8`

```css
disabled:pointer-events-none disabled:opacity-50
```

**Effect:** Button becomes semi-transparent and non-interactive.

### 8.2 Mobile Interactive States

#### Press State (TouchableOpacity)

```tsx
<TouchableOpacity activeOpacity={0.7} onPress={handlePress}>
```

**Effect:** Component fades to 70% opacity when pressed (standard iOS pattern).

#### Disabled State

```tsx
<TouchableOpacity disabled={isDisabled} style={[
  commonStyles.button,
  isDisabled && { opacity: 0.5 }
]}>
```

**Effect:** Reduced opacity and no press handler.

### 8.3 TUI Interactive States

#### Selected/Highlighted State

**Location:** `src/tui/components/session_list.rs:434-445`

```rust
.highlight_style(
    Style::default()
        .bg(Color::DarkGray)
        .add_modifier(Modifier::BOLD)
)
.highlight_symbol("▶ ");
```

**Effect:**
- Dark gray background
- Bold text
- Arrow prefix (`▶`)

#### Focus State (Window Borders)

```rust
// Active window
let border_style = Style::default().fg(Color::Cyan);

// Inactive window
let border_style = Style::default().fg(Color::DarkGray);
```

**Effect:** Border color changes to indicate active window.

### 8.4 Transition Timing

**Web:** All transitions use 200ms duration (fast, responsive).

```css
transition-all duration-200
transition: color 200ms, text-decoration-color 200ms;
```

**Mobile:** Built-in TouchableOpacity animation (instant).

**TUI:** Instant state changes (no transition animations).

---

## 9. Animations

Clauderon uses **minimal, functional animations** that enhance usability without distraction.

### 9.1 Web Animations

#### Transitions

**Standard Transition:**

```tsx
className="transition-all duration-200"
```

**Effect:** Smooth 200ms transition for all properties (color, shadow, transform).

**Specific Properties:**

```css
transition: color 200ms, text-decoration-color 200ms;
```

#### Spinners

**Loader Icon (animated):**

```tsx
import { Loader2 } from "lucide-react";

<Loader2 className="w-4 h-4 animate-spin" />
```

**Effect:** Icon rotates continuously via Tailwind's `animate-spin` class.

**Usage:** Loading states, Claude "Working" status.

#### Transform Animations

**Button Press:**

```css
active:translate-x-1 active:translate-y-1
```

**Icon Hover:**

```tsx
hover:scale-110
```

### 9.2 Mobile Animations

#### TouchableOpacity

Built-in press animation:

```tsx
<TouchableOpacity activeOpacity={0.7}>
```

**Effect:** Instant fade to 70% on press.

#### Animated API

Currently not used. Future animations should use React Native's `Animated` API sparingly.

### 9.3 TUI Animations

#### Spinner Animation

**Location:** `src/tui/components/session_list.rs:305-311`

```rust
let spinner = match app.spinner_tick % 4 {
    0 => "⠋",
    1 => "⠙",
    2 => "⠹",
    _ => "⠸",
};
Span::styled(spinner, Style::default().fg(Color::Green))
```

**Effect:** Braille spinner characters rotate on timer tick (60-120ms intervals).

**Usage:** Indicates Claude "Working" status or session creating.

#### Timer-based Updates

TUI re-renders on timer events (typically 60-100ms) to update spinners and timestamps.

### 9.4 Animation Do's and Don'ts

**DO:**
- ✅ Use animations for **hover/press feedback** (immediate user response)
- ✅ Use animations for **loading indicators** (spinners)
- ✅ Keep durations **under 300ms** (200ms recommended)
- ✅ Use `transition-all` sparingly (prefer specific properties)

**DON'T:**
- ❌ Use gratuitous motion (no bounces, slides, or reveals without purpose)
- ❌ Animate layout shifts (jarring for user)
- ❌ Use durations over 500ms (feels sluggish)
- ❌ Animate non-interactive elements (no pulsing decorations)

---

## 10. Iconography

### 10.1 Web Icons

**Library:** Lucide React

**Installation:**

```bash
bun add lucide-react
```

#### Common Icons

**Location:** `web/frontend/src/components/SessionCard.tsx:4`

```tsx
import {
  Archive,
  Trash2,
  Terminal,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  User,
  Circle,
  AlertTriangle,
  Edit,
  Send,
  Paperclip,
} from "lucide-react";
```

| Icon | Usage | Context |
|------|-------|---------|
| `Terminal` | Session attachment | Open terminal/console |
| `Edit` | Edit session | Modify session details |
| `Archive` | Archive action | Move to archive |
| `Trash2` | Delete action | Permanent deletion |
| `CheckCircle2` | Success/passing | CI passing, PR mergeable |
| `XCircle` | Error/failing | CI failing |
| `Clock` | Pending/waiting | CI pending |
| `Loader2` | Loading/working | Claude working (animated) |
| `User` | User interaction | Waiting for approval |
| `AlertTriangle` | Warning | Merge conflict |
| `Send` | Send message | Chat input |
| `Paperclip` | Attach file | File attachment |
| `Circle` | Idle/neutral | Claude idle |

#### Icon Sizing

```tsx
// Standard icon size (16px)
<Terminal className="w-4 h-4" />

// Small icon (12px)
<Clock className="w-3 h-3" />

// Large icon (20px)
<Terminal className="w-5 h-5" />
```

#### Icon Styles

```tsx
// Default (inherits text color)
<Terminal className="w-4 h-4" />

// Colored
<CheckCircle2 className="w-4 h-4 text-green-500" />

// With hover effect
<Terminal className="w-4 h-4 hover:text-primary" />

// Animated
<Loader2 className="w-4 h-4 animate-spin" />
```

### 10.2 Mobile Icons

**Current Implementation:** Unicode symbols

**Location:** `mobile/src/components/SessionCard.tsx:100-110`

```tsx
function getCheckStatusSymbol(status: CheckStatus): string {
  switch (status) {
    case CheckStatus.Passing:
    case CheckStatus.Mergeable:
    case CheckStatus.Merged:
      return "✓";  // Check mark
    case CheckStatus.Failing:
      return "✗";  // X mark
    case CheckStatus.Pending:
      return "⏱";  // Timer
  }
}
```

**Future:** Consider React Native Vector Icons library for more comprehensive icon set.

### 10.3 TUI Icons

**Unicode Symbols:**

| Symbol | Unicode | Usage |
|--------|---------|-------|
| `▶` | U+25B6 | Selection arrow |
| `⠋⠙⠹⠸` | U+280B, U+2819, U+2839, U+2838 | Braille spinner |
| `⏸` | U+23F8 | Pause |
| `⌨` | U+2328 | Keyboard |
| `○` | U+25CB | Hollow circle (idle) |
| `●` | U+25CF | Filled circle (active) |
| `◎` | U+25CE | Double circle (Claude indicator) |
| `✓` | U+2713 | Check mark |
| `⚠` | U+26A0 | Warning |

### 10.4 Icon Do's and Don'ts

**DO:**
- ✅ Use consistent icon library (Lucide for web)
- ✅ Use consistent sizing (4×4 for standard, 3×3 for small)
- ✅ Provide tooltips for icon-only buttons
- ✅ Use semantic icons (Terminal for terminal, Archive for archive)

**DON'T:**
- ❌ Mix icon libraries (e.g., mixing Lucide with FontAwesome)
- ❌ Use overly decorative icons
- ❌ Create icon-only buttons without hover text on web
- ❌ Use icons smaller than 16×16 pixels (accessibility)

---

## 11. Borders & Outlines

### 11.1 Border Widths

#### Web

**Standard:** `border-2` (2px)

**Location:** `web/frontend/src/index.css:96-98`

```css
button, input, select, textarea {
  border-width: 2px;
}
```

**Thick Borders:** `border-4` (4px) for terminal containers and modal overlays.

**Card Borders:**

```tsx
<Card className="border-2">
```

**Badge Borders:**

```tsx
<Badge variant="outline" className="border-2">
```

#### Mobile

**Standard:** `borderWidth: 2`

**Card/Button:** `borderWidth: 3` (extra emphasis)

**Location:** `mobile/src/styles/common.ts:18, 73`

```typescript
card: {
  borderWidth: 3,
  // ...
}

button: {
  borderWidth: 3,
  // ...
}
```

#### TUI

**Default:** `Borders::ALL` (single-line box drawing characters)

```rust
Block::default().borders(Borders::ALL).border_style(border_style)
```

**Border Types:**
- Single-line: `│ ─ ┌ ┐ └ ┘`
- Double-line: `║ ═ ╔ ╗ ╚ ╝`
- Thick: `┃ ━ ┏ ┓ ┗ ┛`

### 11.2 Border Colors

#### Web

**Default:** `hsl(var(--border))` (light gray in light mode, dark gray in dark mode)

**High Contrast:** `border-foreground` (black in light mode, white in dark mode)

```tsx
// Standard border
<Card className="border-2">

// High contrast border
<Card className="border-2 border-foreground">

// Status-specific border
<div className="border-2 border-status-running">
```

#### Mobile

**Brutalist Choice:** `colors.border` = `#000000` (pure black)

```typescript
borderColor: colors.border,  // Black for maximum contrast
```

**Alternative:** `colors.borderLight` = `#e5e7eb` (gray 200)

#### TUI

**Active:** `Color::Cyan`

**Inactive:** `Color::DarkGray`

**Error:** `Color::Red`

```rust
let border_style = if is_active {
    Style::default().fg(Color::Cyan)
} else {
    Style::default().fg(Color::DarkGray)
};
```

### 11.3 Border Radius

#### Web

**Location:** `web/frontend/src/index.css:34`

```css
--radius: 0.25rem;  /* 4px - minimal brutalist radius */
```

**Usage:**

```tsx
<Button className="rounded-md">  {/* calc(var(--radius) - 2px) = 2px */}
<Card className="rounded-lg">    {/* var(--radius) = 4px */}
```

**Recommendation:** Use minimal radius (0-4px) for brutalist aesthetic.

#### Mobile

**Current Implementation:** No border radius (0px) for hard brutalist look.

```typescript
// No borderRadius property in card/button styles
```

**If needed:** Use `borderRadius: 2` or `borderRadius: 4` sparingly.

#### TUI

Not applicable (terminal uses box-drawing characters).

### 11.4 Border Do's and Don'ts

**DO:**
- ✅ Use **2px borders** as standard on web
- ✅ Use **3px borders** for emphasis on mobile
- ✅ Use **black borders** (`colors.border`) on mobile for brutalist look
- ✅ Keep **border radius minimal** (4px max)
- ✅ Use consistent border styles within a component

**DON'T:**
- ❌ Use borders thinner than 2px (hard to see)
- ❌ Use large border radius (>8px) — anti-brutalist
- ❌ Mix border widths within the same component group
- ❌ Use decorative borders (dashed, dotted) without purpose

---

## 12. Dark Mode

### 12.1 Web Dark Mode

**Implementation:** CSS variables with `.dark` class on `<html>` element.

**Location:** `web/frontend/src/index.css:45-81`

#### Color Changes in Dark Mode

| Token | Light | Dark | Change |
|-------|-------|------|--------|
| `--background` | `0 0% 100%` (white) | `220 90% 8%` (very dark blue) | Background darkens |
| `--foreground` | `220 90% 10%` (dark blue) | `220 10% 95%` (near white) | Text lightens |
| `--primary` | `220 85% 25%` (navy) | `215 100% 60%` (bright blue) | Primary brightens |
| `--border` | `220 20% 80%` (light gray) | `220 50% 25%` (dark gray) | Border darkens |
| Status colors | Base lightness | +10% lightness | More visible on dark background |

#### Toggle Implementation

**Location:** `web/frontend/src/components/ThemeToggle.tsx`

```tsx
// Toggle between light and dark
const toggleTheme = () => {
  document.documentElement.classList.toggle('dark');
  // Persist to localStorage
};
```

#### Dark Mode Best Practices

**DO:**
- ✅ Increase lightness of status colors in dark mode (better visibility)
- ✅ Test all components in both modes
- ✅ Use semantic color tokens (not hard-coded colors)
- ✅ Maintain contrast ratios (WCAG AA minimum)

**DON'T:**
- ❌ Use pure black (`#000000`) as dark mode background (harsh on eyes)
- ❌ Forget to adjust shadow colors (should use lighter colors in dark mode)
- ❌ Hard-code colors instead of using CSS variables

### 12.2 Mobile Dark Mode

**Status:** Not yet implemented.

**Planned Approach:**

```typescript
// colors.ts would export theme objects
export const lightTheme = { ... };
export const darkTheme = { ... };

// App would use theme context
const theme = useColorScheme() === 'dark' ? darkTheme : lightTheme;
```

**Required:**
- Use `Appearance` API to detect system preference
- Theme context provider
- Update all `colors.*` references to `theme.*`

### 12.3 TUI Dark Mode

**Default:** TUI assumes dark terminal background.

**No Light Mode:** Terminal emulators typically use dark backgrounds. Light mode not implemented.

**User Control:** Users can customize terminal color schemes at the terminal emulator level.

---

## 13. Platform-Specific Patterns

### 13.1 Navigation

#### Web Navigation

**Router:** React Router

**Pattern:** Modal overlays for chat and console (not separate pages).

```tsx
// Navigate to chat modal
<Button onClick={() => openChat(session.id)}>
  Open Chat
</Button>
```

**Links:** Fully underlined (2px) with color change on hover.

```css
a {
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 4px;
}
```

#### Mobile Navigation

**Library:** React Navigation

**Pattern:** Stack navigator + Bottom tabs.

**Location:** `mobile/src/navigation/AppNavigator.tsx`

```tsx
<Tab.Navigator>
  <Tab.Screen name="Sessions" component={SessionListScreen} />
  <Tab.Screen name="Settings" component={SettingsScreen} />
</Tab.Navigator>

<Stack.Navigator>
  <Stack.Screen name="Chat" component={ChatScreen} />
</Stack.Navigator>
```

**No Visible Links:** All navigation via `<TouchableOpacity>` (no underlines).

#### TUI Navigation

**Keyboard-Driven:** Modal-based UI with keyboard shortcuts.

**Modes:**
- **Session List Mode**: Arrow keys to select, Enter to attach
- **Attached Mode**: Terminal interaction (all keys forwarded)
- **Copy Mode**: Vi-style navigation for scrolling terminal history

**Mode Switching:**
- `c`: Create session
- `d`: Delete session
- `q`: Quit
- `Esc`: Return to list from dialogs

### 13.2 Forms

#### Web Forms

**Components:** shadcn/ui form components (Label, Input, Select)

**Pattern:** Vertical layout with labels above inputs.

```tsx
<form>
  <Label htmlFor="name">Session Name</Label>
  <Input id="name" placeholder="my-session" />

  <Label htmlFor="repo">Repository</Label>
  <Input id="repo" type="text" />

  <Button type="submit" variant="brutalist">Create</Button>
</form>
```

**Navigation:** Tab key moves between fields, Enter submits.

#### Mobile Forms

**Components:** React Native `TextInput`

**Pattern:** Vertical layout with labels inside or above inputs.

```tsx
<TextInput
  style={commonStyles.input}
  placeholder="Enter daemon URL"
  value={url}
  onChangeText={setUrl}
  keyboardType="url"
  autoCapitalize="none"
/>

<TouchableOpacity style={commonStyles.button} onPress={handleSubmit}>
  <Text style={commonStyles.buttonText}>Save</Text>
</TouchableOpacity>
```

**Keyboard Types:** Use appropriate keyboard (url, email-address, numeric).

**Submit:** Explicit submit button (no keyboard "return" submission).

#### TUI Forms

**Custom Components:** Rust-based TextInput with cursor.

**Pattern:** Modal dialog with field navigation.

```rust
// Tab/Shift+Tab to navigate fields
// Enter to submit
// Esc to cancel
```

**Validation:** Inline error messages below fields.

### 13.3 Terminal/Console

#### Web Console

**Library:** Xterm.js

**Pattern:** Canvas-based terminal emulator in modal.

```tsx
<XtermTerminal
  websocketUrl={`ws://localhost:3030/ws/console/${sessionId}`}
  onResize={handleResize}
/>
```

**Features:**
- Full terminal emulation (ANSI colors, cursor control)
- Resizable container
- WebSocket for I/O

#### Mobile Console

**Not Implemented:** Mobile app uses chat-only interface (no terminal emulator).

**Reason:** Touch keyboards are unsuitable for terminal interaction.

**Alternative:** Parsed message view with Claude's responses and tool uses.

#### TUI Console

**Native PTY:** Direct attachment to session's PTY process.

```rust
// Attach to PTY with direct I/O
tokio::spawn(async move {
    let mut pty = session.attach().await?;
    // Forward stdin/stdout
});
```

**Features:**
- Full terminal emulation via vt100 parser
- Scroll mode (vi-style navigation)
- Copy mode for selecting text

---

## 14. Accessibility

### 14.1 Color Contrast

**Requirement:** All text meets WCAG AA standards (4.5:1 for normal text, 3:1 for large text).

**Web:**
- `--foreground` on `--background`: High contrast in both light and dark modes
- Status colors: Tested against both backgrounds

**Mobile:**
- `colors.text` on `colors.background`: Verified contrast
- `colors.textLight`: Use sparingly, only for non-critical text

**TUI:**
- High contrast terminal colors
- User terminal color schemes may vary (out of our control)

**Testing:**
- Use browser DevTools contrast checker
- Test with tools like [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

### 14.2 Touch Targets (Mobile)

**Minimum Size:** 44×44 points (Apple HIG) / 48×48 dp (Material Design)

**Implementation:**

```typescript
button: {
  paddingVertical: 12,   // + borderWidth: 3 = 30px height minimum
  paddingHorizontal: 20,
  // Total touch target should be at least 44×44
}
```

**Verification:** Ensure all touchable elements meet minimum size, including adequate spacing between adjacent targets.

### 14.3 Focus Indicators

**Web:**

**Location:** `web/frontend/src/index.css:120-123`

```css
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px hsl(var(--ring)), 0 0 0 6px hsl(var(--background));
}
```

**Chunky 4px ring** with 2px gap for maximum visibility (brutalist affordance).

**TUI:**

Selected item has:
- Dark gray background
- Bold text
- `▶` arrow prefix

### 14.4 Screen Readers

**Web:**

- Use semantic HTML (`<button>`, `<nav>`, `<main>`)
- Add `aria-label` to icon-only buttons:

```tsx
<Button variant="ghost" size="icon" aria-label="Attach to terminal">
  <Terminal className="w-4 h-4" />
</Button>
```

- Use proper heading hierarchy (H1 → H2 → H3)

**Mobile:**

- Add `accessibilityLabel` to touchable elements without visible text:

```tsx
<TouchableOpacity
  onPress={handleDelete}
  accessibilityLabel="Delete session"
  accessibilityRole="button"
>
  <Text>🗑</Text>
</TouchableOpacity>
```

- Use `accessibilityRole` to indicate element type

**TUI:**

Screen readers for terminal emulators are limited. Focus on clear text content and logical navigation.

### 14.5 Keyboard Navigation

**Web:**

- All interactive elements reachable via Tab key
- Enter activates buttons/links
- Escape closes modals/dialogs
- Arrow keys in dropdowns/selects

**Mobile:**

- Focus follows native platform patterns (iOS/Android)
- External keyboard support via React Native

**TUI:**

- Full keyboard navigation (no mouse)
- Consistent shortcuts across dialogs (Esc to close, Tab to navigate fields)

---

## 15. Code Standards

### 15.1 Naming Conventions

#### Web (TypeScript/React)

**Files:**
- React components: `PascalCase.tsx` (e.g., `SessionCard.tsx`)
- Utilities: `camelCase.ts` (e.g., `utils.ts`)
- Styles: `kebab-case.css` (e.g., `index.css`)

**Variables:**
- Components: `PascalCase` (`function SessionCard() {}`)
- Functions: `camelCase` (`const formatDate = () => {}`)
- Constants: `SCREAMING_SNAKE_CASE` (`const API_URL = "..."`)

**CSS:**
- Classes: `kebab-case` (Tailwind utilities)
- Variables: `--kebab-case` (CSS custom properties)

```css
--primary: 220 85% 25%;
--status-creating: 220 85% 55%;
```

#### Mobile (TypeScript/React Native)

**Same as Web:** PascalCase for components, camelCase for functions/variables.

**Styles:**

```typescript
const styles = StyleSheet.create({
  card: { ... },           // camelCase
  statusBadge: { ... },
});
```

**Color Exports:**

```typescript
export const colors = {
  primary: "#1e40af",      // camelCase
  primaryDark: "#1e3a8a",
};
```

#### TUI (Rust)

**Files:**
- Modules: `snake_case.rs` (e.g., `session_list.rs`)

**Identifiers:**
- Structs: `PascalCase` (`struct SessionList {}`)
- Enums: `PascalCase` with `PascalCase` variants (`enum SessionStatus { Running, Idle }`)
- Functions: `snake_case` (`fn render_session_list() {}`)
- Variables: `snake_case` (`let session_id = ...`)
- Constants: `SCREAMING_SNAKE_CASE` (`const MAX_WIDTH: usize = 40`)

### 15.2 File Organization

#### Web

```
web/frontend/src/
  components/
    ui/              # Reusable primitives (Button, Card, Badge)
      button.tsx
      card.tsx
      badge.tsx
    SessionCard.tsx  # Feature components
    ChatInterface.tsx
  lib/
    utils.ts         # Utility functions
  index.css          # Global styles + CSS variables
  App.tsx            # Root component
```

**Pattern:** UI primitives in `components/ui/`, feature components at `components/` root.

#### Mobile

```
mobile/src/
  components/        # UI components
    SessionCard.tsx
    MessageBubble.tsx
  styles/            # Centralized style definitions
    colors.ts
    typography.ts
    common.ts
  screens/           # Top-level views
    SessionListScreen.tsx
    ChatScreen.tsx
    SettingsScreen.tsx
  api/               # API clients
  hooks/             # Custom hooks
```

**Pattern:** Centralized styles in `styles/`, screens separate from components.

#### TUI

```
src/tui/
  components/        # UI modules
    session_list.rs
    create_dialog.rs
    status_bar.rs
  ui.rs              # Main render function
  app.rs             # App state
  text_input.rs      # Reusable input component
```

**Pattern:** Each component in its own module, main UI logic in `ui.rs`.

### 15.3 Style Definition Patterns

#### Web (Tailwind + CVA)

**Pattern:** Use Tailwind utility classes + `class-variance-authority` for variants.

```tsx
import { cva } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center border-2",  // Base
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        brutalist: "bg-primary shadow-[4px_4px_0_hsl(var(--foreground))]",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
```

#### Mobile (StyleSheet)

**Pattern:** Create shared styles in `common.ts`, component-specific styles in component files.

```typescript
// common.ts
export const commonStyles = StyleSheet.create({
  card: { ... },
  button: { ... },
});

// SessionCard.tsx
const styles = StyleSheet.create({
  header: { ... },
  statusBadge: { ... },
});

// Usage
<View style={[commonStyles.card, styles.card]} />
```

#### TUI (Inline Style Composition)

**Pattern:** Compose `Style::default()` inline with builder methods.

```rust
let status_style = Style::default()
    .fg(Color::Green)
    .add_modifier(Modifier::BOLD);

Span::styled(text, status_style)
```

---

## 16. Examples & Patterns

### 16.1 Building a Session Card

#### Web Example

```tsx
// SessionCard.tsx
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function SessionCard({ session, onAttach }: SessionCardProps) {
  const statusColors: Record<SessionStatus, string> = {
    [SessionStatus.Running]: "bg-status-running",
    [SessionStatus.Idle]: "bg-status-idle",
    [SessionStatus.Failed]: "bg-status-failed",
    // ...
  };

  return (
    <Card className="border-2 hover:shadow-[4px_4px_0_hsl(var(--foreground))] transition-all">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          {/* Status dot */}
          <div className={`w-4 h-4 border-2 border-foreground ${statusColors[session.status]}`} />

          {/* Title */}
          <h3 className="font-bold text-lg flex-1">{session.name}</h3>

          {/* Backend badge */}
          <Badge variant="outline" className="border-2 font-mono text-xs">
            {session.backend}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <p className="text-sm text-muted-foreground mb-2">
          {session.description}
        </p>

        {/* Status indicators */}
        {session.pr_url && (
          <div className="flex items-center gap-2 text-xs">
            <a href={session.pr_url} className="text-blue-500 font-mono">
              PR #{session.pr_url.split('/').pop()}
            </a>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex gap-2">
        <Button variant="ghost" size="icon" onClick={() => onAttach(session)}>
          <Terminal className="w-4 h-4" />
        </Button>
      </CardFooter>
    </Card>
  );
}
```

#### Mobile Example

```tsx
// SessionCard.tsx
import { TouchableOpacity, View, Text, StyleSheet } from "react-native";
import { colors } from "../styles/colors";
import { typography } from "../styles/typography";
import { commonStyles } from "../styles/common";

export function SessionCard({ session, onPress }: SessionCardProps) {
  const statusColor = getStatusColor(session.status);

  return (
    <TouchableOpacity
      style={[commonStyles.card, styles.card]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {session.name}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusText}>{session.status}</Text>
        </View>
      </View>

      <Text style={styles.repoPath} numberOfLines={1}>
        {session.repo_path}
      </Text>

      <Text style={styles.timestamp}>
        {formatRelativeTime(session.created_at)}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  name: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.textDark,
  },
  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: colors.border,
  },
  statusText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colors.textWhite,
    textTransform: "uppercase",
  },
  repoPath: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.textLight,
  },
  timestamp: {
    fontSize: typography.fontSize.sm,
    color: colors.textLight,
  },
});
```

#### TUI Example

```rust
// session_list.rs
use ratatui::{
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::ListItem,
};

fn render_session_item(session: &Session) -> ListItem {
    let status_style = match session.status {
        SessionStatus::Running => Style::default().fg(Color::Green),
        SessionStatus::Idle => Style::default().fg(Color::Blue),
        SessionStatus::Failed => Style::default().fg(Color::Red),
        // ...
    };

    let status_text = match session.status {
        SessionStatus::Running => "Running",
        SessionStatus::Idle => "Idle",
        SessionStatus::Failed => "Failed",
        // ...
    };

    let line = Line::from(vec![
        Span::styled(
            truncate_with_ellipsis(&session.name, 30),
            Style::default().add_modifier(Modifier::BOLD)
        ),
        Span::raw(" "),
        Span::raw(truncate_with_ellipsis(&session.repo_path, 20)),
        Span::raw(" "),
        Span::styled(status_text, status_style),
    ]);

    ListItem::new(line)
}
```

### 16.2 Applying Status Colors

#### Web

```tsx
const statusColors: Record<SessionStatus, string> = {
  [SessionStatus.Creating]: "bg-status-creating",
  [SessionStatus.Running]: "bg-status-running",
  [SessionStatus.Idle]: "bg-status-idle",
  [SessionStatus.Completed]: "bg-status-completed",
  [SessionStatus.Failed]: "bg-status-failed",
  [SessionStatus.Archived]: "bg-status-archived",
};

<div className={`w-4 h-4 ${statusColors[session.status]}`} />
```

#### Mobile

```typescript
function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "creating":
      return colors.info;        // Blue
    case "running":
      return colors.running;     // Green
    case "idle":
      return colors.idle;        // Amber
    case "completed":
      return colors.completed;   // Blue
    case "failed":
      return colors.failed;      // Red
    case "archived":
      return colors.archived;    // Gray
    default:
      return colors.textLight;
  }
}

<View style={{ backgroundColor: getStatusColor(session.status) }} />
```

#### TUI

```rust
let status_style = match session.status {
    SessionStatus::Creating => Style::default().fg(Color::Yellow),
    SessionStatus::Running => Style::default().fg(Color::Green),
    SessionStatus::Idle => Style::default().fg(Color::Blue),
    SessionStatus::Completed => Style::default().fg(Color::Cyan),
    SessionStatus::Failed => Style::default().fg(Color::Red),
    SessionStatus::Archived => Style::default().fg(Color::DarkGray),
};

Span::styled(status_text, status_style)
```

---

## 17. Testing & QA

### 17.1 Visual Regression

**Reference Screenshots:** Use screenshots in `assets/` as visual baseline.

**Process:**
1. Make design changes
2. Take new screenshots
3. Compare side-by-side with reference images
4. Verify consistency across platforms

**Key Screenshots:**
- Web session list
- Mobile session list
- TUI session list
- Dark mode variants (web)

### 17.2 Cross-Platform Audit

**Checklist:**

- [ ] **Status colors** match semantically (green = running, red = failed, etc.)
- [ ] **Typography scales** are consistent (heading sizes, monospace usage)
- [ ] **Shadows/elevation** follow brutalist patterns (hard shadows on web/iOS)
- [ ] **Interactive states** are clear (hover on web, press on mobile, selection in TUI)
- [ ] **Borders** are consistent (2-3px thickness, minimal radius)
- [ ] **Spacing** follows 4px base unit
- [ ] **Icons** are semantically consistent (Terminal = terminal, Trash = delete)

### 17.3 Accessibility Testing

**Checklist:**

- [ ] **Color contrast** meets WCAG AA (4.5:1 for normal text, 3:1 for large)
- [ ] **Focus indicators** visible (4px ring on web, arrow in TUI)
- [ ] **Touch targets** meet minimum size (44×44 on mobile)
- [ ] **Screen reader labels** present (`aria-label`, `accessibilityLabel`)
- [ ] **Keyboard navigation** functional (Tab, Enter, Escape)

**Tools:**
- Chrome DevTools Lighthouse (accessibility audit)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- Screen readers: VoiceOver (macOS/iOS), TalkBack (Android), NVDA (Windows)

### 17.4 Browser/Device Testing

**Web Browsers:**
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

**Mobile Devices:**
- iOS 16+ (iPhone)
- Android 12+ (various manufacturers)

**Terminal Emulators:**
- iTerm2 (macOS)
- Alacritty (cross-platform)
- GNOME Terminal (Linux)
- Windows Terminal (Windows)

---

## 18. Contributing

### 18.1 When to Update This Guide

Update the style guide when:
- **Adding new components** (document structure, variants, usage)
- **Changing color tokens** (update all three platform tables)
- **Introducing new patterns** (spacing, shadows, animations)
- **Platform-specific divergence** (document why and how platforms differ)
- **Accessibility improvements** (new ARIA patterns, contrast fixes)

### 18.2 Documentation Format

**Required Elements:**

1. **Code Snippets**
   - Include actual code from source files
   - Specify file location and line numbers
   - Show both definition and usage

2. **Visual Examples**
   - Reference screenshots from `assets/`
   - Use inline color swatches for color tables (HTML or markdown)
   - ASCII diagrams for TUI layouts

3. **Cross-Platform Tables**
   - Show web, mobile, and TUI side-by-side
   - Include semantic meaning and usage context

4. **Do's and Don'ts**
   - Practical guidance with ✅ and ❌ markers
   - Explain *why*, not just *what*

**Example:**

```markdown
### Component Name

**Location:** `path/to/file.tsx:10-50`

**Description:** Brief explanation of what the component does.

**Code Example:**

```tsx
<Component prop="value" />
```

**Usage:**

```tsx
// Good example
<Component variant="default" />

// Bad example (and why)
<Component variant="invalid" />  // ❌ Invalid variant
```

**Visual Reference:** `assets/screenshot.png`
```

### 18.3 Review Process

**Steps:**

1. **Make Changes**: Update source code (components, styles, etc.)
2. **Update Style Guide**: Reflect changes in this document
3. **Verify Accuracy**: Test code examples, check line numbers, test on all platforms
4. **Screenshot Updates**: If visual changes, update screenshots in `assets/`
5. **Cross-Reference**: Ensure all three platforms are documented (if applicable)
6. **Pull Request**: Submit with clear description of design changes

**Reviewers Should:**
- Verify cross-platform consistency
- Check that changes align with brutalist philosophy
- Ensure accessibility standards are maintained
- Confirm code examples are accurate and functional

---

## Appendix A: File Reference Index

Quick reference to all key source files.

### Web Frontend

| File | Path | Description |
|------|------|-------------|
| **Colors & Variables** | `web/frontend/src/index.css` | CSS variables, status colors, brutalist base styles |
| **Tailwind Config** | `web/frontend/tailwind.config.js` | Font families, color extensions, spacing |
| **Button** | `web/frontend/src/components/ui/button.tsx` | Button component with brutalist variant |
| **Badge** | `web/frontend/src/components/ui/badge.tsx` | Badge component |
| **Card** | `web/frontend/src/components/ui/card.tsx` | Card component primitives |
| **SessionCard** | `web/frontend/src/components/SessionCard.tsx` | Session card implementation |
| **ChatInterface** | `web/frontend/src/components/ChatInterface.tsx` | Chat interface modal |
| **Font Assets** | `web/frontend/src/assets/fonts/` | Berkeley Mono OpenType files |

### Mobile App

| File | Path | Description |
|------|------|-------------|
| **Colors** | `mobile/src/styles/colors.ts` | Color palette (hex values) |
| **Typography** | `mobile/src/styles/typography.ts` | Font families, sizes, weights |
| **Common Styles** | `mobile/src/styles/common.ts` | Shared StyleSheet definitions |
| **SessionCard** | `mobile/src/components/SessionCard.tsx` | Session card component |
| **MessageBubble** | `mobile/src/components/MessageBubble.tsx` | Chat message component |
| **SessionListScreen** | `mobile/src/screens/SessionListScreen.tsx` | Session list view |
| **ChatScreen** | `mobile/src/screens/ChatScreen.tsx` | Chat interface screen |
| **SettingsScreen** | `mobile/src/screens/SettingsScreen.tsx` | Settings screen |

### TUI (Terminal UI)

| File | Path | Description |
|------|------|-------------|
| **Main UI** | `src/tui/ui.rs` | Root render function, layout splits |
| **Session List** | `src/tui/components/session_list.rs` | Session list table with adaptive columns |
| **Create Dialog** | `src/tui/components/create_dialog.rs` | Session creation modal |
| **Status Bar** | `src/tui/components/status_bar.rs` | Bottom status bar with mode indicators |
| **Text Input** | `src/tui/text_input.rs` | Reusable text input component |
| **Directory Picker** | `src/tui/components/directory_picker.rs` | Fuzzy file browser |

---

## Appendix B: Color Conversion Table

Cross-platform color mapping for consistent visual identity.

### Primary Colors

| Semantic | Web (Light) | Web (Dark) | Mobile | TUI | Hex Reference |
|----------|-------------|------------|--------|-----|---------------|
| **Primary** | `220 85% 25%` | `215 100% 60%` | `#1e40af` | `Color::Cyan` | `#0c2d5e` / `#3399ff` |
| **Background** | `0 0% 100%` | `220 90% 8%` | `#ffffff` / `#0a0f1e` | Terminal default | `#ffffff` / `#030b16` |
| **Foreground** | `220 90% 10%` | `220 10% 95%` | `#111827` / `#eff1f3` | Terminal default | `#0a1929` / `#eff1f3` |
| **Border** | `220 20% 80%` | `220 50% 25%` | `#000000` | `Color::Cyan` / `DarkGray` | `#c7cdd6` / `#000000` |

### Status Colors

| Status | Web (Light HSL) | Mobile (Hex) | TUI (Color) | RGB Equivalent |
|--------|-----------------|--------------|-------------|----------------|
| **Creating** | `220 85% 55%` | `#3b82f6` | `Color::Yellow` | `rgb(59, 130, 246)` |
| **Running** | `142 71% 45%` | `#22c55e` | `Color::Green` | `rgb(34, 197, 94)` |
| **Idle** | `45 93% 47%` | `#f59e0b` | `Color::Blue` | `rgb(245, 158, 11)` |
| **Completed** | `220 13% 55%` | `#3b82f6` | `Color::Cyan` | `rgb(124, 132, 145)` |
| **Failed** | `0 72% 51%` | `#ef4444` | `Color::Red` | `rgb(220, 38, 38)` |
| **Archived** | `220 13% 69%` | `#6b7280` | `Color::DarkGray` | `rgb(155, 163, 176)` |

### Semantic Colors

| Semantic | Web | Mobile | TUI | Usage |
|----------|-----|--------|-----|-------|
| **Success** | `142 71% 45%` | `#22c55e` | `Color::Green` | Positive actions, passing status |
| **Error** | `0 75% 50%` | `#ef4444` | `Color::Red` | Errors, failures, destructive actions |
| **Warning** | `45 93% 47%` | `#f59e0b` | `Color::Yellow` | Warnings, pending states |
| **Info** | `215 100% 45%` | `#3b82f6` | `Color::Cyan` | Informational, neutral highlights |

---

## Appendix C: Component Parity Matrix

Feature availability across platforms.

| Component | Web | Mobile | TUI | Notes |
|-----------|-----|--------|-----|-------|
| **SessionCard** | ✅ | ✅ | ✅ | Different layouts, same information |
| **Button** | ✅ | ✅ | ❌ | TUI uses list highlights instead |
| **Badge** | ✅ | ✅ | ❌ | TUI uses inline colored text |
| **Input** | ✅ | ✅ | ✅ | TUI has custom text input component |
| **ChatInterface** | ✅ | ✅ | ❌ | TUI uses native terminal for Claude interaction |
| **Console/Terminal** | ✅ (Xterm.js) | ❌ | ✅ (Native PTY) | Mobile uses chat-only (no terminal emulator) |
| **StatusBar** | ❌ | ❌ | ✅ | TUI-specific mode indicator |
| **Modal Dialog** | ✅ | ✅ | ✅ | All platforms support modal overlays |
| **Session List** | ✅ (Grid) | ✅ (FlatList) | ✅ (Table) | Different list implementations |
| **File Browser** | ✅ | ❌ | ✅ | Web and TUI support file system browsing |
| **Settings** | ✅ | ✅ | ❌ | TUI uses command-line flags for config |
| **Dark Mode** | ✅ | ❌ | N/A | Mobile dark mode planned, TUI assumes dark |

**Legend:**
- ✅ Implemented
- ❌ Not implemented
- N/A Not applicable

---

## Appendix D: Screenshot Gallery

Visual reference for all UI implementations.

### Web Interface

| Screenshot | Path | Description |
|------------|------|-------------|
| **Session List** | `assets/web session list.png` | Grid of session cards with hover effects |
| **Create Session** | `assets/web create.png` | Session creation dialog |
| **Chat** | `assets/web chat.png` | Chat interface with Claude |
| **Terminal** | `assets/web terminal.png` | Xterm.js terminal emulator |
| **File System** | `assets/web fs 1.png`, `assets/web fs 2.png` | File browser views |
| **Session Info** | `assets/web info.png` | Session details view |

### Mobile Interface (iOS)

| Screenshot | Path | Description |
|------------|------|-------------|
| **Session List** | `assets/ios session list.jpeg` | FlatList of session cards |
| **Chat** | `assets/ios chat.jpeg` | Chat interface with message bubbles |
| **Settings** | `assets/ios settings.jpeg` | Settings screen with daemon URL config |

### TUI (Terminal UI)

| Screenshot | Path | Description |
|------------|------|-------------|
| **Session List** | `assets/tui session list.png` | Table view with color-coded status |
| **Create Session** | `assets/tui create.png` | Modal dialog for session creation |
| **Terminal** | `assets/tui terminal.png` | Attached terminal view |
| **File System** | `assets/tui fs.png` | Directory picker with fuzzy search |

### CLI

| Screenshot | Path | Description |
|------------|------|-------------|
| **CLI Output** | `assets/cli.png` | Command-line interface usage |

---

## Conclusion

This style guide is a living document. As Clauderon evolves, update this guide to reflect new patterns, components, and design decisions. Consistency across platforms creates a cohesive user experience and makes the codebase easier to maintain.

**Questions or Feedback?** Open an issue in the Clauderon repository or discuss in pull requests.

---

**End of Style Guide**
