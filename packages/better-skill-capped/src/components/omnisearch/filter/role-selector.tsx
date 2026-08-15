import React from "react";
import { ROLES, roleDisplayName, type Role } from "#src/model/role";

export type RoleSelectorProps = {
  selectedRoles: Role[];
  onRolesUpdate: (newRoles: Role[]) => void;
};

export default function RoleSelector({
  selectedRoles,
  onRolesUpdate,
}: RoleSelectorProps): React.ReactElement {
  const isChecked = (role: Role) => {
    return selectedRoles.includes(role);
  };

  const toggleRole = (role: Role) => {
    const newRoles = isChecked(role)
      ? selectedRoles.filter((candidate) => candidate !== role)
      : [...selectedRoles, role];
    onRolesUpdate(newRoles);
  };

  return (
    <nav className="panel">
      <p className="panel-heading">Roles</p>
      <div className="panel-block">
        <div className="control">
          {ROLES.map((role) => (
            <div className="field" key={role}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={isChecked(role)}
                  onChange={() => {
                    toggleRole(role);
                  }}
                />{" "}
                {roleDisplayName(role)}
              </label>
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
