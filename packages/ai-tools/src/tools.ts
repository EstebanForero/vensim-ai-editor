// Tool definitions in plain JSON-Schema form. Each maps 1:1 onto a @vensim-ai/core builder
// (or read) function so AI edits and human (UI) edits go through the same mutation path — see
// executor.ts. Provider-agnostic on purpose: the web app adapts these into whichever
// tool-calling shape its OpenAI-compatible client expects (see apps/web/src/lib/openai.ts).

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const position = {
  x: { type: "number", description: "Diagram x coordinate (optional; auto-placed if omitted)." },
  y: { type: "number", description: "Diagram y coordinate (optional; auto-placed if omitted)." },
};

const polarityProperty = {
  type: "string",
  enum: ["+", "-"],
  description:
    "\"+\" (default) if an increase in `from` tends to increase `to`; \"-\" if it tends to decrease it. Required for correct Reinforcing/Balancing loop detection.",
};

export const VENSIM_AI_TOOLS: AiToolDefinition[] = [
  {
    name: "add_stock",
    description:
      "Add a Stock (Level) to the model — a variable that accumulates over time via its inflows and outflows.",
    parameters: {
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
    parameters: {
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
    parameters: {
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
    parameters: {
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
    name: "add_relation",
    description:
      "Add a signed causal relation (a.k.a. connector) from one variable to another — the arrow used both for 'this equation references that variable' links in a stock-flow diagram, and as the only kind of link in a pure causal-loop diagram (variables with no stocks/flows at all). Set `polarity` accurately: it drives automatic Reinforcing/Balancing loop labeling.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source variable name or id." },
        to: { type: "string", description: "Target variable name or id." },
        polarity: polarityProperty,
      },
      required: ["from", "to"],
    },
  },
  {
    name: "set_relation_polarity",
    description: "Change the polarity (+/-) of an existing relation/connector.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The relation's id, from add_relation's result or list_model." },
        polarity: polarityProperty,
      },
      required: ["id", "polarity"],
    },
  },
  {
    name: "set_equation",
    description: "Set or replace a variable's equation (or a stock's initial-value equation).",
    parameters: {
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
    parameters: {
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
    parameters: {
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
    description: "Delete a stock, flow, auxiliary, relation, or comment. Cleans up dangling references.",
    parameters: {
      type: "object",
      properties: { id_or_name: { type: "string" } },
      required: ["id_or_name"],
    },
  },
  {
    name: "add_comment",
    description:
      "Add a freestanding text annotation to the diagram — Vensim's own \"Comment\" sketch tool. Not a variable: carries no equation and never participates in simulation or loop detection. Use it to label sections of the diagram or explain a design decision to a human reader.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        ...position,
      },
      required: ["text"],
    },
  },
  {
    name: "set_comment_text",
    description: "Change an existing comment's text.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, text: { type: "string" } },
      required: ["id", "text"],
    },
  },
  {
    name: "move_comment",
    description: "Move a comment to a new position on the diagram canvas.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
      required: ["id", "x", "y"],
    },
  },
  {
    name: "set_sim_spec",
    description: "Change the simulation settings: start/stop time, time step (dt), integration method, or time units.",
    parameters: {
      type: "object",
      properties: {
        start_time: { type: "number" },
        stop_time: { type: "number" },
        dt: { type: "number" },
        integration_method: { type: "string", enum: ["euler", "rk4"] },
        time_units: { type: "string" },
      },
    },
  },
  {
    name: "auto_layout",
    description:
      "Automatically re-position every stock/flow/auxiliary into a tidy layered layout based on their flow and causal-relation connections, so newly-created or tangled elements don't pile up or drift out of view. Comments are left where they are. Call this after building or substantially restructuring a model, or whenever asked to tidy up / re-arrange the diagram.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["LR", "TB"], description: "LR (left-to-right, default) or TB (top-to-bottom)." },
      },
    },
  },
  {
    name: "list_model",
    description: "Read back the full current model: all stocks, flows, auxiliaries, relations, comments, and sim settings.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "run_simulation",
    description:
      "Run the simulation with the model's current sim spec (start/stop/dt/integration method) and return final values and a downsampled time series for each variable, so results can be inspected before iterating on the model.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_loops",
    description:
      "Detect feedback loops formed by the model's relations and flows. Returns each loop's label (R1, R2, B1, ... — numbered per polarity, matching the canvas badge and annotate_loops), variable names, whether it's Reinforcing (R, an even number of \"-\" relations around the loop) or Balancing (B, an odd number), and its visual rotation (clockwise/counterclockwise) as drawn on the current canvas layout.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "annotate_loops",
    description:
      "Auto-generate one text annotation per detected feedback loop, e.g. \"R1 loop: Population → Births → Population\" — using each element's actual name around the cycle (never a generic placeholder like \"flow\" or \"stock\"), placed near the loop on the canvas. Idempotent: re-running replaces this tool's own earlier output (matched by its own \"R1 loop: \"/\"B2 loop: \" prefix) to reflect the model's current loops, and never touches a comment the user wrote by hand. The annotations are plain comments, so they export identically in both .mdl and .xmile. Call this after building or restructuring a model with feedback loops, or whenever asked to label/explain the loops.",
    parameters: { type: "object", properties: {} },
  },
];
