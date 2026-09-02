import { addAuxiliary, addConnector, addConstant, addFlow, addStock, createEmptyModel, type Model } from "@vensim-ai/core";

function populationGrowth(): Model {
  const model = createEmptyModel("Population Growth");
  const pop = addStock(model, { name: "Population", initialEquation: "100", units: "People", pos: { x: 320, y: 200 } });
  addFlow(model, { name: "Births", equation: "Population * Birth Rate", to: pop.id, pos: { x: 160, y: 200 } });
  addFlow(model, { name: "Deaths", equation: "Population * Death Rate", from: pop.id, pos: { x: 480, y: 200 } });
  addConstant(model, { name: "Birth Rate", value: 0.03, units: "1/Year", pos: { x: 160, y: 300 } });
  addConstant(model, { name: "Death Rate", value: 0.02, units: "1/Year", pos: { x: 480, y: 300 } });
  addConnector(model, { from: "Birth Rate", to: "Births" });
  addConnector(model, { from: "Population", to: "Births" });
  addConnector(model, { from: "Death Rate", to: "Deaths" });
  addConnector(model, { from: "Population", to: "Deaths" });
  model.simSpec = { startTime: 0, stopTime: 50, dt: 0.25, integrationMethod: "rk4", timeUnits: "Year" };
  return model;
}

function sir(): Model {
  const model = createEmptyModel("SIR Epidemic");
  const s = addStock(model, { name: "Susceptible", initialEquation: "990", pos: { x: 140, y: 220 } });
  const i = addStock(model, { name: "Infected", initialEquation: "10", pos: { x: 420, y: 220 } });
  const r = addStock(model, { name: "Recovered", initialEquation: "0", pos: { x: 700, y: 220 } });

  addFlow(model, {
    name: "Infection Rate",
    equation: "Contact Rate * Infectivity * Susceptible * Infected / Total Population",
    from: s.id,
    to: i.id,
    pos: { x: 280, y: 220 },
  });
  addFlow(model, { name: "Recovery Rate", equation: "Infected / Recovery Time", from: i.id, to: r.id, pos: { x: 560, y: 220 } });

  addConstant(model, { name: "Contact Rate", value: 6, pos: { x: 280, y: 320 } });
  addConstant(model, { name: "Infectivity", value: 0.05, pos: { x: 280, y: 380 } });
  addConstant(model, { name: "Recovery Time", value: 5, units: "Days", pos: { x: 560, y: 320 } });
  addAuxiliary(model, { name: "Total Population", equation: "Susceptible + Infected + Recovered", pos: { x: 420, y: 120 } });

  for (const from of ["Susceptible", "Infected", "Total Population", "Contact Rate", "Infectivity"]) {
    addConnector(model, { from, to: "Infection Rate" });
  }
  addConnector(model, { from: "Infected", to: "Recovery Rate" });
  addConnector(model, { from: "Recovery Time", to: "Recovery Rate" });

  model.simSpec = { startTime: 0, stopTime: 60, dt: 0.1, integrationMethod: "rk4", timeUnits: "Days" };
  return model;
}

function inventory(): Model {
  const model = createEmptyModel("Inventory Management");
  const inv = addStock(model, { name: "Inventory", initialEquation: "500", pos: { x: 380, y: 200 } });
  addFlow(model, { name: "Production", equation: "MAX(0, Desired Production)", to: inv.id, pos: { x: 220, y: 200 } });
  addFlow(model, { name: "Shipments", equation: "Order Rate", from: inv.id, pos: { x: 560, y: 200 } });
  addConstant(model, { name: "Order Rate", value: 100, pos: { x: 560, y: 300 } });
  addAuxiliary(model, { name: "Desired Inventory", equation: "Order Rate * Target Coverage", pos: { x: 220, y: 380 } });
  addConstant(model, { name: "Target Coverage", value: 5, units: "Weeks", pos: { x: 100, y: 380 } });
  addAuxiliary(model, { name: "Inventory Gap", equation: "Desired Inventory - Inventory", pos: { x: 380, y: 320 } });
  addAuxiliary(model, { name: "Desired Production", equation: "Order Rate + Inventory Gap / Adjustment Time", pos: { x: 220, y: 300 } });
  addConstant(model, { name: "Adjustment Time", value: 4, units: "Weeks", pos: { x: 100, y: 260 } });

  addConnector(model, { from: "Order Rate", to: "Desired Inventory" });
  addConnector(model, { from: "Target Coverage", to: "Desired Inventory" });
  addConnector(model, { from: "Desired Inventory", to: "Inventory Gap" });
  addConnector(model, { from: "Inventory", to: "Inventory Gap" });
  addConnector(model, { from: "Inventory Gap", to: "Desired Production" });
  addConnector(model, { from: "Order Rate", to: "Desired Production" });
  addConnector(model, { from: "Adjustment Time", to: "Desired Production" });
  addConnector(model, { from: "Desired Production", to: "Production" });
  addConnector(model, { from: "Order Rate", to: "Shipments" });

  model.simSpec = { startTime: 0, stopTime: 52, dt: 0.25, integrationMethod: "rk4", timeUnits: "Weeks" };
  return model;
}

export const SAMPLE_MODELS: { name: string; build: () => Model }[] = [
  { name: "Population Growth", build: populationGrowth },
  { name: "SIR Epidemic", build: sir },
  { name: "Inventory Management", build: inventory },
];
