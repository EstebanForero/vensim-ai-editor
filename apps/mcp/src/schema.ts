// The editor's tools are already described as JSON Schema. MCP wants a Zod schema so it can both
// advertise that shape and reject a call before the handler runs. This converts only the forms
// those definitions use — flat objects, strings, numbers, enums, and arrays of pairs — and fails
// at startup on anything else, so a new tool with a shape this does not understand refuses to
// serve rather than advertising a tool that accepts anything.

import * as z from "zod/v4";

interface JsonSchema {
  type?: string;
  description?: string;
  enum?: string[];
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

function described<T extends z.ZodType>(schema: T, description: string | undefined): T {
  return description ? (schema.describe(description) as T) : schema;
}

function fieldSchema(schema: JsonSchema): z.ZodType {
  if (schema.enum && schema.enum.length > 0) {
    const values = schema.enum as [string, ...string[]];
    return described(z.enum(values), schema.description);
  }
  switch (schema.type) {
    case "string":
      return described(z.string(), schema.description);
    case "number":
      return described(z.number(), schema.description);
    case "boolean":
      return described(z.boolean(), schema.description);
    case "array": {
      const item = schema.items ? fieldSchema(schema.items) : z.unknown();
      let array = z.array(item);
      if (schema.minItems !== undefined) array = array.min(schema.minItems);
      if (schema.maxItems !== undefined) array = array.max(schema.maxItems);
      return described(array, schema.description);
    }
    case "object":
      return inputObject(schema);
    default:
      throw new Error(`unsupported tool parameter schema: ${JSON.stringify(schema)}`);
  }
}

/** A JSON Schema object, as stored on an {@link import("@vensim-ai/ai-tools").AiToolDefinition}. */
export function inputObject(schema: { properties?: Record<string, unknown>; required?: string[] }): z.ZodObject<Record<string, z.ZodType>> {
  const source = schema as JsonSchema;
  const required = new Set(source.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, property] of Object.entries(source.properties ?? {})) {
    const field = fieldSchema(property);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return z.object(shape);
}
