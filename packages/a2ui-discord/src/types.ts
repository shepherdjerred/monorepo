/**
 * A2UI Protocol Types
 * Copied from a2ui-poc for standalone usage
 */

// ============= Bound Values =============

export type BoundString = {
  literalString?: string;
  path?: string;
};

export type BoundNumber = {
  literalNumber?: number;
  path?: string;
};

export type BoundBoolean = {
  literalBoolean?: boolean;
  path?: string;
};

export type BoundArray = {
  literalArray?: string[];
  path?: string;
};

export type BoundValue = BoundString | BoundNumber | BoundBoolean | BoundArray;

// ============= Children Definition =============

export type ExplicitChildren = {
  explicitList: string[];
};

export type TemplateChildren = {
  template: {
    componentId: string;
    dataBinding: string;
  };
};

export type Children = ExplicitChildren | TemplateChildren;

// ============= Action Definition =============

export type ActionContext = {
  key: string;
  value: BoundString | BoundNumber | BoundBoolean;
};

export type Action = {
  name: string;
  context?: ActionContext[];
};

// ============= Standard Catalog Components =============

export type TextUsageHint =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "caption"
  | "body";

export type TextComponent = {
  Text: {
    text: BoundString;
    usageHint?: TextUsageHint;
  };
};

export type ButtonComponent = {
  Button: {
    child: string;
    primary?: boolean;
    action: Action;
  };
};

export type CardComponent = {
  Card: {
    child: string;
  };
};

export type RowDistribution =
  | "center"
  | "end"
  | "spaceAround"
  | "spaceBetween"
  | "spaceEvenly"
  | "start";

export type Alignment = "start" | "center" | "end" | "stretch";

export type RowComponent = {
  Row: {
    children: Children;
    distribution?: RowDistribution;
    alignment?: Alignment;
  };
};

export type ColumnDistribution =
  | "start"
  | "center"
  | "end"
  | "spaceBetween"
  | "spaceAround"
  | "spaceEvenly";

export type ColumnComponent = {
  Column: {
    children: Children;
    distribution?: ColumnDistribution;
    alignment?: Alignment;
  };
};

export type ListComponent = {
  List: {
    children: Children;
    direction?: "vertical" | "horizontal";
    alignment?: Alignment;
  };
};

export type ImageFit = "contain" | "cover" | "fill" | "none" | "scale-down";
export type ImageUsageHint =
  | "icon"
  | "avatar"
  | "smallFeature"
  | "mediumFeature"
  | "largeFeature"
  | "header";

export type ImageComponent = {
  Image: {
    url: BoundString;
    fit?: ImageFit;
    usageHint?: ImageUsageHint;
  };
};

export type IconComponent = {
  Icon: {
    name: BoundString;
  };
};

export type DividerComponent = {
  Divider: {
    axis?: "horizontal" | "vertical";
  };
};

export type TabItem = {
  title: BoundString;
  child: string;
};

export type TabsComponent = {
  Tabs: {
    tabItems: TabItem[];
  };
};

export type ProgressIndicatorComponent = {
  ProgressIndicator: {
    progress: BoundNumber;
    label?: BoundString;
  };
};

export type ComponentDefinition =
  | TextComponent
  | ButtonComponent
  | CardComponent
  | RowComponent
  | ColumnComponent
  | ListComponent
  | ImageComponent
  | IconComponent
  | DividerComponent
  | TabsComponent
  | ProgressIndicatorComponent;

// ============= Component Wrapper =============

export type A2UIComponent = {
  id: string;
  weight?: number;
  component: ComponentDefinition;
};

// ============= Message Types =============

export type SurfaceUpdate = {
  surfaceUpdate: {
    surfaceId: string;
    components: A2UIComponent[];
  };
};

export type DataModelEntry = {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: DataModelEntry[];
};

export type DataModelUpdate = {
  dataModelUpdate: {
    surfaceId: string;
    path?: string;
    contents: DataModelEntry[];
  };
};

export type BeginRendering = {
  beginRendering: {
    surfaceId: string;
    catalogId?: string;
    root: string;
    styles?: Record<string, unknown>;
  };
};

export type DeleteSurface = {
  deleteSurface: {
    surfaceId: string;
  };
};

export type A2UIMessage =
  | SurfaceUpdate
  | DataModelUpdate
  | BeginRendering
  | DeleteSurface;

// ============= Client-to-Server Events =============

export type UserAction = {
  userAction: {
    name: string;
    surfaceId: string;
    sourceComponentId: string;
    timestamp: string;
    context: Record<string, unknown>;
  };
};

// ============= Type Guards =============

export function isSurfaceUpdate(msg: A2UIMessage): msg is SurfaceUpdate {
  return "surfaceUpdate" in msg;
}

export function isDataModelUpdate(msg: A2UIMessage): msg is DataModelUpdate {
  return "dataModelUpdate" in msg;
}

export function isBeginRendering(msg: A2UIMessage): msg is BeginRendering {
  return "beginRendering" in msg;
}

export function isDeleteSurface(msg: A2UIMessage): msg is DeleteSurface {
  return "deleteSurface" in msg;
}
