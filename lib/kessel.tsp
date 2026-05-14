// Kessel Schema Library
// Core types for expressing Kessel resource schemas in TypeSpec.
// Data fields use native TypeSpec types (→ JSONSchema via built-in emitter).
// Relations use typed wrappers (→ SpiceDB/Zed via custom emitter).

namespace Kessel;

// ─── Cardinality ─────────────────────────────────────────────────────

enum Cardinality {
  AtMostOne,
  ExactlyOne,
  AtLeastOne,
  Any,
  All,
}

// ─── Relation Types ──────────────────────────────────────────────────
// These are marker models used as property types to describe
// Zanzibar-style authorization relations on resource types.

/** An assignable relation — can be directly reported via the Inventory API */
@doc("Assignable relation to {target}")
model Assignable<Target, Card extends Cardinality> {
  @doc("target")
  __target: Target;

  @doc("cardinality")
  __cardinality: Card;
}

// ─── Permission Expression Types ─────────────────────────────────────
// Type-safe AST for permission expressions. TypeSpec's type checker
// validates structure at compile time — no runtime parser needed.

/** Reference to a local relation by name */
model Ref<Name extends string> {
  __kind: "ref";
  __name: Name;
}

/** Sub-reference: relation arrow sub-permission (relation->sub in SpiceDB) */
model SubRef<Relation extends string, Sub extends string> {
  __kind: "subref";
  __relation: Relation;
  __sub: Sub;
}

/** Union of two permission expressions (+ in SpiceDB) */
model Or<Left, Right> {
  __kind: "or";
  __left: Left;
  __right: Right;
}

/** Intersection of two permission expressions (& in SpiceDB) */
model And<Left, Right> {
  __kind: "and";
  __left: Left;
  __right: Right;
}

/** A computed permission — derived from set operations, not directly assignable */
model Permission<Expr> {
  @doc("expression")
  __expr: Expr;
}

/** Boolean relation — can hold wildcard references (target:*) */
model BoolRelation<Target> {
  @doc("boolean assignable to target type wildcard")
  __target: Target;
}

// ─── Convenience Aliases ─────────────────────────────────────────────

/** Shorthand for a permission that delegates to a workspace sub-relation. */
alias WorkspacePermission<Name extends string> = Permission<SubRef<"workspace", Name>>;
