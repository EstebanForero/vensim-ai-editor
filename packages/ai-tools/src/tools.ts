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
    "\"+\" if an increase in `from` (holding every other input fixed) tends to increase `to`; \"-\" if it tends to decrease it. Correct polarity is required for correct Reinforcing/Balancing loop detection, so don't guess: think through the actual causal effect the way you'd take a partial derivative — e.g. for `Rate = Pressure / Resistance`, Pressure is \"+\" (increasing it increases Rate) and Resistance is \"-\" (increasing it decreases Rate). Omit this field entirely when `to` already has an equation — it's inferred automatically from that equation's structure, which is more reliable than guessing from the variable names alone; only pass it explicitly when the target has no equation yet, or when the structural sign is genuinely ambiguous (e.g. a difference of two terms) and you can reason it out from context.",
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
    name: "refresh_relation_polarities",
    description:
      "Re-infers polarity for every relation whose target variable's own equation determines it structurally, and updates any that changed. Call this after building or substantially editing equations (set_equation already does this automatically for relations pointing at the one variable just edited, but this catches everything at once) — never needed after add_relation alone, which already infers polarity itself. Leaves anything genuinely ambiguous (or targeting a stock) untouched, so it never overwrites a deliberate polarity choice with a guess.",
    parameters: { type: "object", properties: {} },
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
        // Vensim's own .mdl format has no dedicated "time units" field — this value is written
        // as the literal ~units line on TIME STEP/INITIAL TIME/FINAL TIME/SAVEPER (see
        // mdl/writer.ts), and real Vensim only recognizes a fixed set of English time-unit
        // words there for its own unit-checking and DELAY/SMOOTH-family defaults. A model whose
        // simulation prompt is in Spanish (or any other language) still needs an English value
        // here — "días" is not a word Vensim's importer recognizes, and it's a plain string this
        // schema previously let the model set to anything, silently producing a model whose time
        // axis Vensim can't reason about even though the numeric TIME STEP itself still loads
        // and runs unchanged.
        time_units: {
          type: "string",
          enum: ["Second", "Minute", "Hour", "Day", "Week", "Month", "Quarter", "Year"],
          description:
            "Always an English Vensim time-unit keyword, regardless of what language the rest of the conversation or the model's variable names are in.",
        },
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
    name: "check_units",
    description:
      "Runs a Vensim-Ctrl+U-style structural units check across every stock/flow/auxiliary that has an equation: computes what units the equation's right-hand side actually works out to (by multiplying/dividing the declared units of whatever variables it references) and compares that against the variable's own declared `units` field, plus flags internal inconsistencies within an equation (e.g. adding two differently-unit'd terms, or MIN/MAX arguments that don't share units) regardless of the declared field. Only confident structural mismatches are reported — a variable with no declared units, or an equation this analysis can't fully resolve, is never flagged. Call this after building or editing a model's equations/units, or whenever asked to check/audit units.",
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
