/**
 * A2UI Component Builders
 * Helper functions to construct A2UI components with proper typing
 */

import type {
  A2UIComponent,
  BoundString,
  BoundNumber,
  Action,
  ActionContext,
  TextUsageHint,
  RowDistribution,
  ColumnDistribution,
  Alignment,
  Children,
  ImageFit,
  ImageUsageHint,
} from "./types.js";

// ============= Bound Value Helpers =============

export function literal(value: string): BoundString {
  return { literalString: value };
}

export function bound(path: string): BoundString {
  return { path };
}

export function boundWithDefault(path: string, defaultValue: string): BoundString {
  return { path, literalString: defaultValue };
}

export function literalNumber(value: number): BoundNumber {
  return { literalNumber: value };
}

export function boundNumber(path: string): BoundNumber {
  return { path };
}

// ============= Action Builder =============

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

export function text(
  id: string,
  textValue: BoundString,
  usageHint?: TextUsageHint
): A2UIComponent {
  return {
    id,
    component: {
      Text: usageHint
        ? { text: textValue, usageHint }
        : { text: textValue },
    },
  };
}

export function button(
  id: string,
  childId: string,
  buttonAction: Action,
  primary = false
): A2UIComponent {
  return {
    id,
    component: {
      Button: { child: childId, action: buttonAction, primary },
    },
  };
}

export function card(id: string, childId: string): A2UIComponent {
  return {
    id,
    component: {
      Card: { child: childId },
    },
  };
}

export function column(
  id: string,
  children: string[],
  options?: {
    distribution?: ColumnDistribution;
    alignment?: Alignment;
  }
): A2UIComponent {
  return {
    id,
    component: {
      Column: {
        children: { explicitList: children },
        ...options,
      },
    },
  };
}

export function row(
  id: string,
  children: string[],
  options?: {
    distribution?: RowDistribution;
    alignment?: Alignment;
  }
): A2UIComponent {
  return {
    id,
    component: {
      Row: {
        children: { explicitList: children },
        ...options,
      },
    },
  };
}

export function list(
  id: string,
  children: Children,
  direction: "vertical" | "horizontal" = "vertical",
  alignment?: Alignment
): A2UIComponent {
  const listProps: { children: Children; direction: "vertical" | "horizontal"; alignment?: Alignment } = {
    children,
    direction,
  };
  if (alignment) {
    listProps.alignment = alignment;
  }
  return {
    id,
    component: {
      List: listProps,
    },
  };
}

export function icon(id: string, name: string): A2UIComponent {
  return {
    id,
    component: {
      Icon: { name: { literalString: name } },
    },
  };
}

export function divider(
  id: string,
  axis: "horizontal" | "vertical" = "horizontal"
): A2UIComponent {
  return {
    id,
    component: {
      Divider: { axis },
    },
  };
}

export function image(
  id: string,
  url: BoundString,
  options?: {
    fit?: ImageFit;
    usageHint?: ImageUsageHint;
  }
): A2UIComponent {
  return {
    id,
    component: {
      Image: { url, ...options },
    },
  };
}

export function progressIndicator(
  id: string,
  progress: BoundNumber,
  label?: BoundString
): A2UIComponent {
  return {
    id,
    component: {
      ProgressIndicator: label
        ? { progress, label }
        : { progress },
    },
  };
}

export function tabs(
  id: string,
  tabItems: Array<{ title: BoundString; child: string }>
): A2UIComponent {
  return {
    id,
    component: {
      Tabs: { tabItems },
    },
  };
}

export function modal(
  id: string,
  entryPointChild: string,
  contentChild: string
): A2UIComponent {
  return {
    id,
    component: {
      Modal: { entryPointChild, contentChild },
    },
  };
}

export function video(
  id: string,
  url: BoundString,
  options?: {
    autoplay?: boolean;
    loop?: boolean;
  }
): A2UIComponent {
  return {
    id,
    component: {
      Video: { url, ...options },
    },
  };
}

export function audioPlayer(
  id: string,
  url: BoundString,
  description?: BoundString
): A2UIComponent {
  return {
    id,
    component: {
      AudioPlayer: description ? { url, description } : { url },
    },
  };
}

export function checkbox(
  id: string,
  label: BoundString,
  value: BoundString,
  checkboxAction: Action
): A2UIComponent {
  return {
    id,
    component: {
      CheckBox: {
        label,
        value: { path: value.path || value.literalString || "" },
        action: checkboxAction,
      },
    },
  };
}

export function textField(
  id: string,
  type: "shortText" | "longText" | "number" | "date" | "obscured",
  value: BoundString,
  fieldAction: Action,
  options?: {
    placeholder?: BoundString;
    label?: BoundString;
  }
): A2UIComponent {
  return {
    id,
    component: {
      TextField: {
        type,
        value,
        action: fieldAction,
        ...options,
      },
    },
  };
}

export function multipleChoice(
  id: string,
  choiceOptions: Array<{ label: BoundString; value: BoundString }>,
  value: BoundString,
  choiceAction: Action,
  label?: BoundString
): A2UIComponent {
  return {
    id,
    component: {
      MultipleChoice: {
        options: choiceOptions,
        value,
        action: choiceAction,
        ...(label && { label }),
      },
    },
  };
}

export function slider(
  id: string,
  value: BoundNumber,
  min: BoundNumber,
  max: BoundNumber,
  sliderAction: Action,
  options?: {
    step?: BoundNumber;
    label?: BoundString;
  }
): A2UIComponent {
  return {
    id,
    component: {
      Slider: {
        value,
        min,
        max,
        action: sliderAction,
        ...options,
      },
    },
  };
}

export function dateTimeInput(
  id: string,
  type: "date" | "time" | "datetime",
  value: BoundString,
  dateTimeAction: Action,
  label?: BoundString
): A2UIComponent {
  return {
    id,
    component: {
      DateTimeInput: {
        type,
        value,
        action: dateTimeAction,
        ...(label && { label }),
      },
    },
  };
}
