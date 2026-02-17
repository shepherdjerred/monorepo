export enum Type {
  DANGER,
  SUCCESS,
  WARNING,
  PRIMARY,
}

export function getColorForType(type: Type): string {
  switch (type) {
    case Type.WARNING:
      return "yellow";
    case Type.SUCCESS:
      return "green";
    case Type.DANGER:
      return "red";
    case Type.PRIMARY:
      return "blue";
  }
}
