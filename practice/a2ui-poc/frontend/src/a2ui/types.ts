/**
 * A2UI Protocol Types for Frontend
 * Mirrors the backend types for type safety
 */

export interface BoundString {
  literalString?: string;
  path?: string;
}

export interface BoundNumber {
  literalNumber?: number;
  path?: string;
}

export interface BoundBoolean {
  literalBoolean?: boolean;
  path?: string;
}

export type BoundValue = BoundString | BoundNumber | BoundBoolean;

export interface ExplicitChildren {
  explicitList: string[];
}

export interface TemplateChildren {
  template: {
    componentId: string;
    dataBinding: string;
  };
}

export type Children = ExplicitChildren | TemplateChildren;

export interface Action {
  name: string;
  context?: Array<{
    key: string;
    value: BoundString | BoundNumber | BoundBoolean;
  }>;
}

// Component definitions
export interface TextComponent {
  Text: {
    text: BoundString;
    usageHint?: "h1" | "h2" | "h3" | "h4" | "h5" | "caption" | "body";
  };
}

export interface ButtonComponent {
  Button: {
    child: string;
    primary?: boolean;
    action: Action;
  };
}

export interface CardComponent {
  Card: {
    child: string;
  };
}

export interface RowComponent {
  Row: {
    children: Children;
    distribution?: string;
    alignment?: string;
  };
}

export interface ColumnComponent {
  Column: {
    children: Children;
    distribution?: string;
    alignment?: string;
  };
}

export interface ListComponent {
  List: {
    children: Children;
    direction?: "vertical" | "horizontal";
    alignment?: string;
  };
}

export interface IconComponent {
  Icon: {
    name: BoundString;
  };
}

export interface DividerComponent {
  Divider: {
    axis?: "horizontal" | "vertical";
  };
}

export interface ProgressIndicatorComponent {
  ProgressIndicator: {
    progress: BoundNumber;
    label?: BoundString;
  };
}

export interface TabItem {
  title: BoundString;
  child: string;
}

export interface TabsComponent {
  Tabs: {
    tabItems: TabItem[];
  };
}

export interface ImageComponent {
  Image: {
    url: BoundString;
    fit?: "contain" | "cover" | "fill" | "none" | "scale-down";
    usageHint?:
      | "icon"
      | "avatar"
      | "smallFeature"
      | "mediumFeature"
      | "largeFeature"
      | "header";
  };
}

export interface ModalComponent {
  Modal: {
    entryPointChild: string;
    contentChild: string;
  };
}

export interface VideoComponent {
  Video: {
    url: BoundString;
    autoplay?: boolean;
    loop?: boolean;
  };
}

export interface AudioPlayerComponent {
  AudioPlayer: {
    url: BoundString;
    description?: BoundString;
  };
}

export interface CheckBoxComponent {
  CheckBox: {
    label: BoundString;
    value: BoundBoolean;
    action: Action;
  };
}

export type TextFieldType =
  | "shortText"
  | "longText"
  | "number"
  | "date"
  | "obscured";

export interface TextFieldComponent {
  TextField: {
    type: TextFieldType;
    value: BoundString;
    placeholder?: BoundString;
    label?: BoundString;
    action: Action;
  };
}

export interface DateTimeInputComponent {
  DateTimeInput: {
    value: BoundString;
    type: "date" | "time" | "datetime";
    label?: BoundString;
    action: Action;
  };
}

export interface MultipleChoiceOption {
  label: BoundString;
  value: BoundString;
}

export interface MultipleChoiceComponent {
  MultipleChoice: {
    options: MultipleChoiceOption[];
    value: BoundString;
    label?: BoundString;
    action: Action;
  };
}

export interface SliderComponent {
  Slider: {
    value: BoundNumber;
    min: BoundNumber;
    max: BoundNumber;
    step?: BoundNumber;
    label?: BoundString;
    action: Action;
  };
}

export type ComponentDefinition =
  | TextComponent
  | ButtonComponent
  | CardComponent
  | RowComponent
  | ColumnComponent
  | ListComponent
  | IconComponent
  | DividerComponent
  | TabsComponent
  | ImageComponent
  | ModalComponent
  | VideoComponent
  | AudioPlayerComponent
  | CheckBoxComponent
  | TextFieldComponent
  | DateTimeInputComponent
  | MultipleChoiceComponent
  | SliderComponent
  | ProgressIndicatorComponent;

export interface A2UIComponent {
  id: string;
  weight?: number;
  component: ComponentDefinition;
}

// Message types
export interface SurfaceUpdate {
  surfaceUpdate: {
    surfaceId: string;
    components: A2UIComponent[];
  };
}

export interface DataModelEntry {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: DataModelEntry[];
}

export interface DataModelUpdate {
  dataModelUpdate: {
    surfaceId: string;
    path?: string;
    contents: DataModelEntry[];
  };
}

export interface BeginRendering {
  beginRendering: {
    surfaceId: string;
    catalogId?: string;
    root: string;
  };
}

export interface DeleteSurface {
  deleteSurface: {
    surfaceId: string;
  };
}

export type A2UIMessage =
  | SurfaceUpdate
  | DataModelUpdate
  | BeginRendering
  | DeleteSurface;

export interface UserAction {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
}
