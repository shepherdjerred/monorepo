export function cleanTargets(
  packageRoot: string,
  home: string,
): readonly [string, string, string] {
  return [
    `${packageRoot}/ios/build`,
    `${packageRoot}/ios/Pods`,
    `${home}/Library/Developer/Xcode/DerivedData/TasksForObsidian-*`,
  ];
}

export function outputPath(argument?: string): string {
  return argument ?? "/tmp/device.log";
}
