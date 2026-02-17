export type Stage = {
  name: "main" | "prod";
  revision: string;
};

export type MainStage = Stage & { name: "main" };
export type ProdStage = Stage & { name: "prod" };

export type Stages = {
  main: MainStage;
  prod: ProdStage;
};
