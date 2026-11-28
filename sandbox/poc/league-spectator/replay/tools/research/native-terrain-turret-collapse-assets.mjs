// The original Chaos turret skin 3 Death graph selects a 30 Hz atomic clip.
// Its visibility events show Stage2 and Stage3 at frame zero, hide Stage2 at
// frame 16, and reveal the rubble at frame 57 (the settled interval).
export const chaosTurretCollapseStage2End = 16 / 30;
export const chaosTurretCollapseModelPath =
  "/structure-models/0fc522597c23fd8cbc0c306f3b242cbfa87ce0e0c5e73ec6f0aa8204b17da454.glb";
export const chaosTurretCollapsePaths = {
  bindings:
    "/structure-animations/4f51ca89d8175f82f0b105f7819a77fe5fbb1df35183496e69b0f15478a4d5dd.json",
  clip: "/structure-animations/03a79f04459748e3a44154cd7ae157b43c6dbe72ad63db8eb9bd99e162289484.clip",
  rig: "/structure-animations/b1529afe7d27cda9c4fb3bd19a9f6529e20af5dbb330eb41148ad5000370f83f.skl",
};
