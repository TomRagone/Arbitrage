import type { BoolExpr, StrategyDSL } from "./types";
import { FEATURE_REGISTRY } from "./registry";

export class CausalViolationException extends Error {}

const PRICE_FIELDS = new Set(["open", "high", "low", "close"]);
const VALUE_EXPR_TYPES = new Set(["const", "feature", "price"]);
const BOOL_EXPR_TYPES = new Set(["gt", "lt", "and", "or"]);

function validateValueExpr(expr: unknown, path: string): void {
  if (typeof expr !== "object" || expr === null) {
    throw new CausalViolationException(`${path}: expected a ValueExpr object, got ${JSON.stringify(expr)}`);
  }
  const node = expr as Record<string, unknown>;
  if (typeof node.type !== "string" || !VALUE_EXPR_TYPES.has(node.type)) {
    throw new CausalViolationException(`${path}: malformed ValueExpr — unknown type ${JSON.stringify(node.type)}`);
  }

  switch (node.type) {
    case "const":
      if (typeof node.value !== "number") {
        throw new CausalViolationException(`${path}: const.value must be a number, got ${JSON.stringify(node.value)}`);
      }
      return;
    case "price":
      if (typeof node.field !== "string" || !PRICE_FIELDS.has(node.field)) {
        throw new CausalViolationException(`${path}: price.field must be one of open/high/low/close, got ${JSON.stringify(node.field)}`);
      }
      return;
    case "feature":
      if (typeof node.name !== "string") {
        throw new CausalViolationException(`${path}: feature.name must be a string, got ${JSON.stringify(node.name)}`);
      }
      if (!(node.name in FEATURE_REGISTRY)) {
        throw new CausalViolationException(`${path}: feature "${node.name}" is not present in FEATURE_REGISTRY — causal whitelist violation`);
      }
      return;
  }
}

function validateBoolExpr(expr: unknown, path: string): void {
  if (typeof expr !== "object" || expr === null) {
    throw new CausalViolationException(`${path}: expected a BoolExpr object, got ${JSON.stringify(expr)}`);
  }
  const node = expr as Record<string, unknown>;
  if (typeof node.type !== "string" || !BOOL_EXPR_TYPES.has(node.type)) {
    throw new CausalViolationException(`${path}: malformed BoolExpr — unknown type ${JSON.stringify(node.type)}`);
  }

  switch (node.type) {
    case "gt":
    case "lt":
      validateValueExpr(node.left, `${path}.left`);
      validateValueExpr(node.right, `${path}.right`);
      return;
    case "and":
    case "or":
      validateBoolExpr(node.left, `${path}.left`);
      validateBoolExpr(node.right, `${path}.right`);
      return;
  }
}

export function validateStrategy(s: StrategyDSL): void {
  if (typeof s !== "object" || s === null) {
    throw new CausalViolationException(`strategy: expected a StrategyDSL object, got ${JSON.stringify(s)}`);
  }
  if (s.side !== "LONG" && s.side !== "SHORT") {
    throw new CausalViolationException(`strategy.side: must be LONG or SHORT, got ${JSON.stringify((s as { side?: unknown }).side)}`);
  }
  validateBoolExpr(s.entry as BoolExpr, "strategy.entry");
  validateBoolExpr(s.exit as BoolExpr, "strategy.exit");
}
