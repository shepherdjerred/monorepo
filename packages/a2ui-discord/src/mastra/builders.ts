/**
 * A2UI Component Builders for Mastra
 * Helper functions to easily create common UI patterns
 */

import type {
  A2UIComponent,
  A2UIMessage,
  BoundString,
  BoundNumber,
  Action,
  ActionContext,
  TextUsageHint,
  RowDistribution,
  ColumnDistribution,
  Alignment,
} from "../types.js";

// ============= ID Generation =============

let idCounter = 0;

/**
 * Generate a unique component ID
 */
export function uid(prefix = "c"): string {
  idCounter++;
  return `${prefix}-${String(idCounter)}`;
}

/**
 * Reset the ID counter (useful for testing)
 */
export function resetUidCounter(): void {
  idCounter = 0;
}

// ============= Bound Value Helpers =============

/**
 * Create a literal string value
 */
export function literal(value: string): BoundString {
  return { literalString: value };
}

/**
 * Create a path binding
 */
export function bound(path: string): BoundString {
  return { path };
}

/**
 * Create a literal number value
 */
export function literalNumber(value: number): BoundNumber {
  return { literalNumber: value };
}

/**
 * Create a number path binding
 */
export function boundNumber(path: string): BoundNumber {
  return { path };
}

// ============= Action Helpers =============

/**
 * Create an action with optional context
 */
export function action(
  name: string,
  context?: Record<string, string | number | boolean>
): Action {
  if (!context) {
    return { name };
  }

  const actionContext: ActionContext[] = Object.entries(context).map(
    ([key, value]) => ({
      key,
      value:
        typeof value === "string"
          ? { literalString: value }
          : typeof value === "number"
            ? { literalNumber: value }
            : { literalBoolean: value },
    })
  );

  return { name, context: actionContext };
}

// ============= Component Builders =============

/**
 * Create a text component
 */
export function text(
  textValue: string | BoundString,
  usageHint?: TextUsageHint,
  id = uid("text")
): A2UIComponent {
  const textBound = typeof textValue === "string" ? literal(textValue) : textValue;
  return {
    id,
    component: {
      Text: usageHint ? { text: textBound, usageHint } : { text: textBound },
    },
  };
}

/**
 * Create a button component
 */
export function button(
  label: string,
  actionDef: Action,
  options?: { primary?: boolean; id?: string }
): A2UIComponent[] {
  const btnId = options?.id ?? uid("btn");
  const labelId = `${btnId}-label`;

  return [
    {
      id: labelId,
      component: {
        Text: { text: literal(label) },
      },
    },
    {
      id: btnId,
      component: {
        Button: {
          child: labelId,
          action: actionDef,
          primary: options?.primary ?? false,
        },
      },
    },
  ];
}

/**
 * Create a card component
 */
export function card(
  children: A2UIComponent[],
  id = uid("card")
): A2UIComponent[] {
  // Create a column to hold card content
  const contentId = `${id}-content`;
  const childIds = children.map((c) => c.id);

  return [
    ...children,
    {
      id: contentId,
      component: {
        Column: { children: { explicitList: childIds } },
      },
    },
    {
      id,
      component: {
        Card: { child: contentId },
      },
    },
  ];
}

/**
 * Create a row component
 */
export function row(
  children: A2UIComponent[],
  options?: {
    distribution?: RowDistribution;
    alignment?: Alignment;
    id?: string;
  }
): A2UIComponent[] {
  const rowId = options?.id ?? uid("row");
  const childIds = children.map((c) => c.id);

  const rowComponent: A2UIComponent = {
    id: rowId,
    component: {
      Row: {
        children: { explicitList: childIds },
      },
    },
  };

  // Add optional properties only if defined
  if (options?.distribution !== undefined) {
    (rowComponent.component as { Row: { children: { explicitList: string[] }; distribution?: RowDistribution } }).Row.distribution = options.distribution;
  }
  if (options?.alignment !== undefined) {
    (rowComponent.component as { Row: { children: { explicitList: string[] }; alignment?: Alignment } }).Row.alignment = options.alignment;
  }

  return [...children, rowComponent];
}

/**
 * Create a column component
 */
export function column(
  children: A2UIComponent[],
  options?: {
    distribution?: ColumnDistribution;
    alignment?: Alignment;
    id?: string;
  }
): A2UIComponent[] {
  const colId = options?.id ?? uid("col");
  const childIds = children.map((c) => c.id);

  const colComponent: A2UIComponent = {
    id: colId,
    component: {
      Column: {
        children: { explicitList: childIds },
      },
    },
  };

  // Add optional properties only if defined
  if (options?.distribution !== undefined) {
    (colComponent.component as { Column: { children: { explicitList: string[] }; distribution?: ColumnDistribution } }).Column.distribution = options.distribution;
  }
  if (options?.alignment !== undefined) {
    (colComponent.component as { Column: { children: { explicitList: string[] }; alignment?: Alignment } }).Column.alignment = options.alignment;
  }

  return [...children, colComponent];
}

/**
 * Create a divider component
 */
export function divider(
  axis: "horizontal" | "vertical" = "horizontal",
  id = uid("div")
): A2UIComponent {
  return {
    id,
    component: {
      Divider: { axis },
    },
  };
}

/**
 * Create an icon component
 */
export function icon(name: string, id = uid("icon")): A2UIComponent {
  return {
    id,
    component: {
      Icon: { name: literal(name) },
    },
  };
}

/**
 * Create a progress indicator component
 */
export function progress(
  value: number | BoundNumber,
  label?: string | BoundString,
  id = uid("progress")
): A2UIComponent {
  const progressValue = typeof value === "number" ? literalNumber(value) : value;
  const labelValue = label
    ? typeof label === "string"
      ? literal(label)
      : label
    : undefined;

  return {
    id,
    component: {
      ProgressIndicator: labelValue
        ? { progress: progressValue, label: labelValue }
        : { progress: progressValue },
    },
  };
}

/**
 * Create an image component
 */
export function image(
  url: string | BoundString,
  options?: {
    fit?: "contain" | "cover" | "fill" | "none" | "scale-down";
    usageHint?: "icon" | "avatar" | "smallFeature" | "mediumFeature" | "largeFeature" | "header";
    id?: string;
  }
): A2UIComponent {
  const urlValue = typeof url === "string" ? literal(url) : url;

  const imageComponent: A2UIComponent = {
    id: options?.id ?? uid("img"),
    component: {
      Image: {
        url: urlValue,
      },
    },
  };

  // Add optional properties only if defined
  const imgDef = imageComponent.component as { Image: { url: BoundString; fit?: string; usageHint?: string } };
  if (options?.fit !== undefined) {
    imgDef.Image.fit = options.fit;
  }
  if (options?.usageHint !== undefined) {
    imgDef.Image.usageHint = options.usageHint;
  }

  return imageComponent;
}

// ============= Message Builders =============

/**
 * Create a surface update message
 */
export function surfaceUpdate(
  surfaceId: string,
  components: A2UIComponent[]
): A2UIMessage {
  return {
    surfaceUpdate: {
      surfaceId,
      components,
    },
  };
}

/**
 * Create a data model update message
 */
export function dataModelUpdate(
  surfaceId: string,
  data: Record<string, string | number | boolean | Record<string, unknown>>
): A2UIMessage {
  const contents = Object.entries(data).map(([key, value]) => {
    if (typeof value === "string") {
      return { key, valueString: value };
    }
    if (typeof value === "number") {
      return { key, valueNumber: value };
    }
    if (typeof value === "boolean") {
      return { key, valueBoolean: value };
    }
    // Nested object - recursive
    return {
      key,
      valueMap: Object.entries(value).map(([k, v]) => ({
        key: k,
        ...(typeof v === "string" ? { valueString: v } : {}),
        ...(typeof v === "number" ? { valueNumber: v } : {}),
        ...(typeof v === "boolean" ? { valueBoolean: v } : {}),
      })),
    };
  });

  return {
    dataModelUpdate: {
      surfaceId,
      contents,
    },
  };
}

/**
 * Create a begin rendering message
 */
export function beginRendering(
  surfaceId: string,
  rootId: string
): A2UIMessage {
  return {
    beginRendering: {
      surfaceId,
      root: rootId,
    },
  };
}

// ============= High-Level UI Builders =============

/**
 * Build a complete info card with title, description, and optional buttons
 */
export function infoCard(
  title: string,
  description: string,
  buttons?: { label: string; action: Action; primary?: boolean }[]
): { components: A2UIComponent[]; rootId: string } {
  const components: A2UIComponent[] = [];

  const titleComp = text(title, "h2");
  const dividerComp = divider();
  const descComp = text(description, "body");

  components.push(titleComp, dividerComp, descComp);

  const contentIds = [titleComp.id, dividerComp.id, descComp.id];

  if (buttons && buttons.length > 0) {
    const buttonIds: string[] = [];

    for (const btn of buttons) {
      const btnComps = button(btn.label, btn.action, {
        primary: btn.primary === true,
      });
      components.push(...btnComps);
      // The button component is the second item (after the label)
      const btnComp = btnComps[1];
      if (btnComp) {
        buttonIds.push(btnComp.id);
      }
    }

    const buttonRowId = uid("btn-row");
    components.push({
      id: buttonRowId,
      component: {
        Row: {
          children: { explicitList: buttonIds },
        },
      },
    });
    contentIds.push(buttonRowId);
  }

  const contentColId = uid("content-col");
  components.push({
    id: contentColId,
    component: {
      Column: {
        children: { explicitList: contentIds },
      },
    },
  });

  const cardId = uid("card");
  components.push({
    id: cardId,
    component: {
      Card: { child: contentColId },
    },
  });

  return {
    components,
    rootId: cardId,
  };
}

/**
 * Build a confirmation dialog with Yes/No buttons
 */
export function confirmDialog(
  message: string,
  confirmAction: Action,
  cancelAction: Action
): { components: A2UIComponent[]; rootId: string } {
  const components: A2UIComponent[] = [];

  const messageComp = text(message, "body");
  components.push(messageComp);

  const confirmBtnComps = button("Confirm", confirmAction, { primary: true });
  const cancelBtnComps = button("Cancel", cancelAction, { primary: false });

  components.push(...confirmBtnComps, ...cancelBtnComps);

  const confirmBtnId = confirmBtnComps[1]?.id ?? "confirm-btn";
  const cancelBtnId = cancelBtnComps[1]?.id ?? "cancel-btn";

  const buttonRowId = uid("btn-row");
  components.push({
    id: buttonRowId,
    component: {
      Row: {
        children: { explicitList: [confirmBtnId, cancelBtnId] },
      },
    },
  });

  const contentColId = uid("content-col");
  components.push({
    id: contentColId,
    component: {
      Column: {
        children: { explicitList: [messageComp.id, buttonRowId] },
      },
    },
  });

  const cardId = uid("card");
  components.push({
    id: cardId,
    component: {
      Card: { child: contentColId },
    },
  });

  return {
    components,
    rootId: cardId,
  };
}

/**
 * Build a progress card showing a task status
 */
export function progressCard(
  title: string,
  progressValue: number,
  status?: string
): { components: A2UIComponent[]; rootId: string } {
  const titleComp = text(title, "h3");
  const progressComp = progress(progressValue, status);

  const cardComps = card([titleComp, progressComp]);
  const rootId = cardComps[cardComps.length - 1]?.id ?? "root";

  return {
    components: cardComps,
    rootId,
  };
}

/**
 * Build a list of items with icons
 */
export function iconList(
  items: { icon: string; text: string }[]
): { components: A2UIComponent[]; rootId: string } {
  const components: A2UIComponent[] = [];
  const rowIds: string[] = [];

  for (const item of items) {
    const iconComp = icon(item.icon);
    const textComp = text(item.text, "body");
    const itemRowId = uid("item-row");

    const rowComp: A2UIComponent = {
      id: itemRowId,
      component: {
        Row: {
          children: { explicitList: [iconComp.id, textComp.id] },
        },
      },
    };

    // Add alignment
    (rowComp.component as { Row: { children: { explicitList: string[] }; alignment?: Alignment } }).Row.alignment = "center";

    components.push(iconComp, textComp, rowComp);
    rowIds.push(itemRowId);
  }

  const listColId = uid("list-col");
  components.push({
    id: listColId,
    component: {
      Column: {
        children: { explicitList: rowIds },
      },
    },
  });

  return {
    components,
    rootId: listColId,
  };
}
