# figma-use Complete Command Reference

## Style Shorthands

### Size & Position

| Short          | Full                 | Values             |
| -------------- | -------------------- | ------------------ |
| `w`, `h`       | width, height        | number or `"fill"` |
| `minW`, `maxW` | minWidth, maxWidth   | number             |
| `minH`, `maxH` | minHeight, maxHeight | number             |
| `x`, `y`       | position             | number             |

### Layout

| Short                  | Full              | Values                                      |
| ---------------------- | ----------------- | ------------------------------------------- |
| `flex`                 | flexDirection     | `"row"`, `"col"`                            |
| `gap`                  | spacing           | number                                      |
| `wrap`                 | layoutWrap        | `true`                                      |
| `justify`              | justifyContent    | `"start"`, `"center"`, `"end"`, `"between"` |
| `items`                | alignItems        | `"start"`, `"center"`, `"end"`              |
| `p`, `px`, `py`        | padding           | number                                      |
| `pt`, `pr`, `pb`, `pl` | padding sides     | number                                      |
| `position`             | layoutPositioning | `"absolute"`                                |
| `grow`                 | layoutGrow        | number                                      |
| `stretch`              | layoutAlign       | `true` -> STRETCH                           |

### Appearance

| Short         | Full         | Values                  |
| ------------- | ------------ | ----------------------- |
| `bg`          | fill         | hex or `$Variable`      |
| `stroke`      | strokeColor  | hex                     |
| `strokeWidth` | strokeWeight | number                  |
| `strokeAlign` | strokeAlign  | `"inside"`, `"outside"` |
| `opacity`     | opacity      | 0..1                    |
| `blendMode`   | blendMode    | `"multiply"`, etc.      |

### Corners

| Short                | Full               | Values           |
| -------------------- | ------------------ | ---------------- |
| `rounded`            | cornerRadius       | number           |
| `roundedTL/TR/BL/BR` | individual corners | number           |
| `cornerSmoothing`    | squircle smoothing | 0..1 (iOS style) |

### Effects

| Short      | Full         | Values                           |
| ---------- | ------------ | -------------------------------- |
| `shadow`   | dropShadow   | `"0px 4px 8px rgba(0,0,0,0.25)"` |
| `blur`     | layerBlur    | number                           |
| `overflow` | clipsContent | `"hidden"`                       |
| `rotate`   | rotation     | degrees                          |

### Text

| Short    | Full       | Values           |
| -------- | ---------- | ---------------- |
| `size`   | fontSize   | number           |
| `weight` | fontWeight | `"bold"`, number |
| `font`   | fontFamily | string           |
| `color`  | textColor  | hex              |

### Grid (CSS Grid layout)

| Short     | Full                | Values             |
| --------- | ------------------- | ------------------ |
| `display` | layoutMode          | `"grid"`           |
| `cols`    | gridTemplateColumns | `"100px 1fr auto"` |
| `rows`    | gridTemplateRows    | `"auto auto"`      |
| `colGap`  | columnGap           | number             |
| `rowGap`  | rowGap              | number             |

## Components

First call creates master, rest create instances:

```tsx
import { defineComponent, Frame, Text } from "figma-use/render";

const Card = defineComponent(
  "Card",
  <Frame p={24} bg="#FFF" rounded={12}>
    <Text size={18} color="#000">
      Card
    </Text>
  </Frame>,
);

export default () => (
  <Frame gap={16} flex="row">
    <Card />
    <Card />
  </Frame>
);
```

Render: `figma-use render ./Card.figma.tsx --x 100 --y 200`

## Variants (ComponentSet)

```tsx
import { defineComponentSet, Frame, Text } from "figma-use/render";

const Button = defineComponentSet(
  "Button",
  {
    variant: ["Primary", "Secondary"] as const,
    size: ["Small", "Large"] as const,
  },
  ({ variant, size }) => (
    <Frame
      p={size === "Large" ? 16 : 8}
      bg={variant === "Primary" ? "#3B82F6" : "#E5E7EB"}
      rounded={8}
    >
      <Text color={variant === "Primary" ? "#FFF" : "#111"}>
        {variant} {size}
      </Text>
    </Frame>
  ),
);
```

## Variables as Tokens

Reference Figma variables with `var:Name` or `$Name`:

```bash
figma-use create rect --width 100 --height 100 --fill 'var:Colors/Primary'
figma-use set fill <id> '$Brand/Accent'
```

In JSX: `<Frame bg="$Colors/Primary" />`

## Export JSX

Convert Figma nodes back to JSX:

```bash
figma-use export jsx <id>           # Minified
figma-use export jsx <id> --pretty  # Formatted
figma-use export jsx <id> --match-icons  # Match vectors to Iconify icons
```

Round-trip: `figma-use export jsx <id> --pretty > component.tsx` -> edit -> `figma-use render component.tsx`

## Diffs

```bash
figma-use diff create --from <id1> --to <id2>
figma-use diff apply patch.diff
figma-use diff apply patch.diff --dry-run
figma-use diff visual --from <id1> --to <id2> --output diff.png
```

## Query (XPath)

```bash
figma-use query "//FRAME"                              # All frames
figma-use query "//FRAME[@width < 300]"                # By attribute
figma-use query "//COMPONENT[starts-with(@name, 'Button')]"
figma-use query "//SECTION//TEXT"                       # Descendants
figma-use query "//*[@cornerRadius > 0]"               # Any node
```

Attributes: `name`, `width`, `height`, `x`, `y`, `cornerRadius`, `opacity`, `visible`, `characters`, `fontSize`, `layoutMode`, `itemSpacing`

## Analyze

```bash
figma-use analyze clusters                # Repeated patterns
figma-use analyze colors --show-similar   # Color palette
figma-use analyze typography              # Font combinations
figma-use analyze spacing --grid 8        # Grid compliance
figma-use analyze snapshot                # Accessibility snapshot
```

## Lint

```bash
figma-use lint                          # Recommended preset
figma-use lint --preset strict
figma-use lint --preset accessibility   # Contrast, touch targets
figma-use lint -v                       # With fix suggestions
```

Presets: `recommended`, `strict`, `accessibility`, `design-system`

## Common Operations

```bash
# Navigate
figma-use page list
figma-use page set "Page Name"
figma-use viewport zoom-to-fit <id>

# Find
figma-use find --name "Button"
figma-use find --type FRAME
figma-use selection get
figma-use node ancestors <id>

# Modify
figma-use set fill <id> "#FF0000"
figma-use set radius <id> 12
figma-use set text <id> "New text"
figma-use set layout <id> --mode VERTICAL --gap 12 --padding 16
figma-use node resize <id> --width 300 --height 200
figma-use node delete <id>
figma-use arrange --mode grid --gap 60

# Clone & move between pages
figma-use node clone <id> --json | jq -r '.[].id'
figma-use node set-parent <new-id> --parent <target-page-id>

# Replace
figma-use node replace-with <id> --target <component-id>
echo '<Icon name="lucide:x" size={16} />' | figma-use node replace-with <id> --stdin

# Convert to component
figma-use node to-component <id>

# Sections
figma-use create section --name "Buttons" --x 0 --y 0 --width 600 --height 200

# SVG import
figma-use import --svg "$(cat icon.svg)"

# Comment-driven workflow
figma-use comment watch --json     # Blocks until new comment
figma-use comment add "Done!" --reply <comment-id>
figma-use comment resolve <comment-id>
```

## Node IDs

Format: `session:local` (e.g., `1:23`). Inside instances: `I<instance-id>;<internal-id>`.

Get IDs from `figma-use selection get` or `figma-use node tree`.

## Colors

- Hex: `#RGB`, `#RRGGBB`, `#RRGGBBAA`
- Variables: `var:Colors/Primary` or `$Colors/Primary`

## Vector Paths

Iterative workflow: draw, export screenshot, adjust, repeat.

```bash
figma-use create vector --path "M 50 0 L 100 100 L 0 100 Z" --fill "#F00"
figma-use path scale <id> --factor 0.8
figma-use path move <id> --dx 20 --dy -10
figma-use path flip <id> --axis x
figma-use path set <id> "M 50 0 C 80 30 80 70 50 100 C 20 70 20 30 50 0 Z"
```
