// Tool definitions in Anthropic Messages API tool-use format. Each tool maps 1:1 onto a
// @vensim-ai/core builder function so AI edits and human (UI) edits go through the same
// mutation path — see executor.ts.

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const position = {
  x: { type: "number", description: "Diagram x coordinate (optional; auto-placed if omitted)." },
  y: { type: "number", description: "Diagram y coordinate (optional; auto-placed if omitted)." },
};

export const VENSIM_AI_TOOLS: AnthropicTool[] = [
  {
    name: "add_stock",
    description:
      "Add a Stock (Level) to the model — a variable that accumulates over time via its inflows and outflows.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique variable name." },
        initial_equation: { type: "string", description: "Initial value, e.g. \"100\" or a constant's name. Defaults to 0." },
        units: { type: "string" },
        comment: { type: "string" },
        ...position,
      },
      required: ["name"],
    },
  },
  {
    name: "add_flow",
    description:
      "Add a Flow (Rate) that moves material into and/or out of stocks. Provide `from` and/or `to` as an existing stock's name or id; omit one side for a cloud source/sink.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        equation: { type: "string", description: "Flow rate equation, e.g. \"Population * Birth Rate\". Defaults to 0." },
        from: { type: "string", description: "Stock this flow drains (name or id), or omit for a cloud source." },
        to: { type: "string", description: "Stock this flow fills (name or id), or omit for a cloud sink." },
        units: { type: "string" },
        comment: { type: "string" },
        ...position,
      },
      required: ["name"],
    },
  },
  {
    name: "add_auxiliary",
    description: "Add an Auxiliary — a computed variable that is a function of other variables.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        equation: { type: "string", description: "e.g. \"Inventory / Target Coverage\"." },
        units: { type: "string" },
        comment: { type: "string" },
        ...position,
      },
      required: ["name", "equation"],
    },
  },
  {
    name: "add_constant",
    description: "Add a Constant — a named parameter with a fixed numeric value (a special case of Auxiliary).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        value: { type: "number" },
        units: { type: "string" },
        comment: { type: "string" },
        ...position,
      },
      required: ["name", "value"],
    },
  },
  {
    name: "add_connector",
    description:
      "Add a causal information-link arrow from one variable to another (used when a variable's equation references another, to keep the diagram legible).",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source variable name or id." },
        to: { type: "string", description: "Target variable name or id." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "set_equation",
    description: "Set or replace a variable's equation (or a stock's initial-value equation).",
    input_schema: {
      type: "object",
      properties: {
        id_or_name: { type: "string" },
        equation: { type: "string" },
        which: { type: "string", enum: ["equation", "initial"], description: "Use \"initial\" only for a stock's initial value." },
      },
      required: ["id_or_name", "equation"],
    },
  },
  {
    name: "rename_variable",
    description: "Rename a variable. All equations referencing its old name are updated automatically.",
    input_schema: {
      type: "object",
      properties: {
        id_or_name: { type: "string" },
        new_name: { type: "string" },
      },
      required: ["id_or_name", "new_name"],
    },
  },
  {
    name: "move_element",
    description: "Move a variable to a new position on the diagram canvas.",
    input_schema: {
      type: "object",
      properties: {
        id_or_name: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["id_or_name", "x", "y"],
    },
  },
  {
    name: "delete_element",
    description: "Delete a stock, flow, auxiliary, or connector. Cleans up dangling references.",
    input_schema: {
      type: "object",
      properties: { id_or_name: { type: "string" } },
      required: ["id_or_name"],
    },
  },
  {
    name: "list_model",
    description: "Read back the full current model: all stocks, flows, auxiliaries, connectors, and their equations.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "run_simulation",
    description:
      "Run the simulation with the model's current sim spec (start/stop/dt/integration method) and return final values and a downsampled time series for each variable, so results can be inspected before iterating on the model.",
    input_schema: { type: "object", properties: {} },
  },
];
