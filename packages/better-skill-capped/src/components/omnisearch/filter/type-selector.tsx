import React from "react";
import type { Kind } from "#src/model/content";

export type TypeSelectorProps = {
  selectedTypes: Kind[];
  onTypesUpdate: (newTypes: Kind[]) => void;
};

const TYPE_LABELS: Record<Kind, string> = {
  video: "Video",
  commentary: "Commentary",
  course: "Course",
};

const TYPE_ORDER: Kind[] = ["video", "commentary", "course"];

export default function TypeSelector({
  selectedTypes,
  onTypesUpdate,
}: TypeSelectorProps): React.ReactElement {
  const isChecked = (type: Kind) => {
    return selectedTypes.includes(type);
  };

  const toggleType = (type: Kind) => {
    const newTypes = isChecked(type)
      ? selectedTypes.filter((candidate) => candidate !== type)
      : [...selectedTypes, type];
    onTypesUpdate(newTypes);
  };

  return (
    <nav className="panel">
      <p className="panel-heading">Type</p>
      <div className="panel-block">
        <div className="control">
          {TYPE_ORDER.map((type) => (
            <div className="field" key={type}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  onChange={() => {
                    toggleType(type);
                  }}
                  checked={isChecked(type)}
                />{" "}
                {TYPE_LABELS[type]}
              </label>
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
