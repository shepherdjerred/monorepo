import React from "react";
import { Role } from "../../../model/Role";

export interface RoleSelectorProps {
  selectedRoles: Role[];
  onRolesUpdate: (newRoles: Role[]) => void;
}

export default function RoleSelector({ selectedRoles, onRolesUpdate }: RoleSelectorProps): React.ReactElement {
  const isChecked = (role: Role) => {
    return (
      selectedRoles.find((candidate) => {
        return candidate === role;
      }) !== undefined
    );
  };

  const getNewRoles = (role: Role) => {
    let newRoles = selectedRoles.slice();
    if (isChecked(role)) {
      newRoles = newRoles.filter((candidate) => {
        return candidate !== role;
      });
    } else {
      newRoles.push(role);
    }
    onRolesUpdate(newRoles);
  };

  return (
    <nav className="panel">
      <p className="panel-heading">Roles</p>
      <div className="panel-block">
        <div className="control">
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={isChecked(Role.TOP)}
                onChange={() => {
                  getNewRoles(Role.TOP);
                }}
              />{" "}
              Top
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={isChecked(Role.JUNGLE)}
                onChange={() => {
                  getNewRoles(Role.JUNGLE);
                }}
              />{" "}
              Jungle
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={isChecked(Role.MID)}
                onChange={() => {
                  getNewRoles(Role.MID);
                }}
              />{" "}
              Mid
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={isChecked(Role.ADC)}
                onChange={() => {
                  getNewRoles(Role.ADC);
                }}
              />{" "}
              ADC
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={isChecked(Role.SUPPORT)}
                onChange={() => {
                  getNewRoles(Role.SUPPORT);
                }}
              />{" "}
              Support
            </label>
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={isChecked(Role.ALL)}
                onChange={() => {
                  getNewRoles(Role.ALL);
                }}
              />{" "}
              Not Role Specific
            </label>
          </div>
        </div>
      </div>
    </nav>
  );
}
