# Visualization & Diagramming Packages

Typst has a rich ecosystem of visualization packages. Use these to make documents scannable and reader-friendly — diagrams, charts, and callouts communicate faster than prose.

## When to Use What

| Need                                                    | Package        | Why                                      |
| ------------------------------------------------------- | -------------- | ---------------------------------------- |
| Flowcharts, architecture diagrams, node-arrow figures   | `fletcher`     | Declarative node/edge API, built on CeTZ |
| Custom drawings, geometric figures, coordinate graphics | `cetz`         | TikZ-like general-purpose drawing        |
| Data plots (line, scatter, bar, contour, boxplot)       | `lilaq`        | Publication-quality scientific plots     |
| Graphviz DOT diagrams                                   | `diagraph`     | Renders DOT with Typst-native labels     |
| Sequence, ERD, component, activity, mind map, Gantt     | `pintorita`    | Pintora-based multi-diagram tool         |
| Gantt charts, project timelines                         | `timeliney`    | Dedicated Gantt chart layout             |
| Info/warning/tip callout boxes                          | `gentle-clues` | Predefined admonition styles             |

## Package Imports

```typst
#import "@preview/fletcher:0.5.8": diagram, node, edge
#import "@preview/cetz:0.4.2"
#import "@preview/lilaq:0.6.0" as lq
#import "@preview/diagraph:0.3.6": *
#import "@preview/pintorita:0.1.4"
#import "@preview/timeliney:0.4.0"
#import "@preview/gentle-clues:1.3.1": *
```

---

## Fletcher — Node & Arrow Diagrams

Best for: architecture diagrams, flowcharts, state machines, dependency graphs.

```typst
#import "@preview/fletcher:0.5.8": diagram, node, edge

#diagram(
  node((0, 0), [Client], name: <client>),
  node((2, 0), [API Server], name: <api>),
  node((4, 0), [Database], name: <db>),
  edge(<client>, <api>, "->", [HTTP]),
  edge(<api>, <db>, "->", [SQL]),
)
```

Key features:

- Nodes placed on a coordinate grid
- Edges with labels, arrow styles (`"->""`, `"<->"`, `"--"`, `"=>"`)
- Named nodes via `name: <label>` for readable edge definitions
- Styling: `stroke`, `fill`, `corner-radius` on nodes

## CeTZ — General Purpose Drawing

Best for: geometric figures, custom diagrams, coordinate-based graphics.

```typst
#import "@preview/cetz:0.4.2"

#cetz.canvas({
  import cetz.draw: *
  circle((0, 0), radius: 1)
  line((0, 0), (2, 1), stroke: blue)
  content((2, 1.3), [Label])
})
```

Sub-libraries:

- `cetz-plot` — Line plots, bar charts within CeTZ canvas
- `cetz-venn` — Venn diagrams

## Lilaq — Scientific Data Visualization

Best for: data-driven charts, benchmarks, statistical plots.

```typst
#import "@preview/lilaq:0.6.0" as lq

#lq.diagram(
  lq.plot((1, 2, 3, 4), (10, 20, 15, 25), label: "Series A"),
  lq.xlabel[Time],
  lq.ylabel[Value],
)
```

Supported plot types: line, scatter, bar, boxplot, stem, quiver, error bars, colormesh, contour. Supports dual axes, color bars, and legends.

Documentation: https://lilaq.org

## Diagraph — Graphviz DOT

Best for: dependency graphs, class hierarchies, network topologies — anything naturally expressed in DOT.

```typst
#import "@preview/diagraph:0.3.6": *

#render("
  digraph {
    rankdir=LR
    A -> B -> C
    A -> C [style=dashed]
  }
")
```

Supports Typst content as node/edge labels via `$ math $` or string labels.

## Pintorita — Multi-Diagram Tool

Best for: sequence diagrams, ERDs, component diagrams, activity diagrams, mind maps, Gantt charts.

Based on Pintora (inspired by Mermaid/PlantUML). Uses text-based diagram definitions.

```typst
#import "@preview/pintorita:0.1.4"

#pintorita.render("
  sequenceDiagram
    Client ->> Server: Request
    Server -->> Client: Response
")
```

Styles: `default`, `dark`, `larkLight`, `larkDark`.

## Timeliney — Gantt Charts

Best for: project timelines, phase planning, roadmaps.

```typst
#import "@preview/timeliney:0.4.0"

#timeliney.timeline(
  show-grid: true,
  timeliney.headers(("Q1", 3), ("Q2", 3), ("Q3", 3)),
  timeliney.taskgroup(title: [Phase 1], {
    timeliney.task("Research", (0, 2), style: (stroke: 2pt + blue))
    timeliney.task("Design", (1, 4), style: (stroke: 2pt + green))
  }),
  timeliney.taskgroup(title: [Phase 2], {
    timeliney.task("Build", (3, 7), style: (stroke: 2pt + orange))
    timeliney.task("Test", (6, 9), style: (stroke: 2pt + red))
  }),
)
```

## Gentle-Clues — Admonition Callout Boxes

Best for: highlighting key findings, warnings, tips, recommendations.

```typst
#import "@preview/gentle-clues:1.3.1": *

#info[This approach is recommended for most use cases.]
#warning[This will cause downtime during migration.]
#tip[Consider batching requests to reduce latency.]
#note[See Section 3 for detailed benchmarks.]
```

Available clues: `info`, `tip`, `warning`, `note`, `success`, `error`, `example`, `quote`, `question`, `abstract`, `conclusion`, `memo`, `task`.

Custom clues:

```typst
#clue(title: "Key Finding", accent-color: purple, icon: emoji.magnify)[
  The primary bottleneck is database connection pooling.
]
```

---

## Design Principles

When producing Typst documents, do not mechanically convert Markdown. Instead:

1. **Replace prose comparisons with tables** — readers scan tables 5x faster than paragraphs
2. **Use diagrams for relationships** — architecture, data flow, state machines, dependencies
3. **Add callout boxes for key takeaways** — findings, warnings, and recommendations should stand out visually
4. **Use charts for data** — benchmarks, trends, and statistics are clearer as plots than as inline numbers
5. **Create visual hierarchy** — headings, spacing, color, and layout should guide the reader's eye so they can understand the core message by scanning for 60 seconds
