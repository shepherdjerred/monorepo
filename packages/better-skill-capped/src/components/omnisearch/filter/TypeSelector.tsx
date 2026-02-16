import React from "react";
import Type from "../../../model/Type";

export interface TypeSelectorProps {
  selectedTypes: Type[];
  onTypesUpdate: (newTypes: Type[]) => void;
}

export default function TypeSelector({ selectedTypes, onTypesUpdate }: TypeSelectorProps): React.ReactElement {
  const isChecked = (type: Type) => {
    return (
      selectedTypes.find((candidate) => {
        return candidate === type;
      }) !== undefined
    );
  };

  const getNewTypes = (type: Type) => {
    let newTypes = selectedTypes.slice();
    if (isChecked(type)) {
      newTypes = newTypes.filter((candidate) => {
        return candidate !== type;
      });
    } else {
      newTypes.push(type);
    }
    onTypesUpdate(newTypes);
  };

  return (
    <nav className="panel">
      <p className="panel-heading">Type</p>
      <div className="panel-block">
        <div className="control">
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                onChange={() => {
                  getNewTypes(Type.VIDEO);
                }}
                checked={isChecked(Type.VIDEO)}
              />{" "}
              Video
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                onChange={() => {
                  getNewTypes(Type.COMMENTARY);
                }}
                checked={isChecked(Type.COMMENTARY)}
              />{" "}
              Commentary
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                onChange={() => {
                  getNewTypes(Type.COURSE);
                }}
                checked={isChecked(Type.COURSE)}
              />{" "}
              Course
            </label>
          </div>
        </div>
      </div>
    </nav>
  );
}
