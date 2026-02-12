import { describe, it, expect } from "vitest";
import { parseAst, findIdentifiers, shouldIgnoreIdentifier, Identifier, AstNode } from "../ast-utils";

function findNode(ast: AstNode, predicate: (node: AstNode) => boolean): AstNode | undefined {
  const stack: AstNode[] = [ast];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (predicate(node)) return node;
    for (const key in node) {
      if (key === "parent" || key === "loc" || key === "range" || key === "tokens" || key === "comments") continue;
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (const child of val) if (child && typeof child === 'object') stack.push(child);
      } else if (val && typeof val === 'object') {
        stack.push(val);
      }
    }
  }
  return undefined;
}

describe("ast-utils", () => {
  it("should ignore property keys in destructuring assignment (VariableDeclarator)", () => {
    const code = `const { x } = { x: 2 };`;
    const ast = parseAst(code, "typescript");
    const identifiers = findIdentifiers(ast);

    // Locate the RHS object expression { x: 2 }
    const rhsObject = findNode(ast, (n) => n.type === "ObjectExpression" && (n as any).properties?.length === 1 && (n as any).properties[0].value.type === "Literal") as any;
    expect(rhsObject).toBeDefined();

    const rhsProperty = rhsObject.properties[0];
    const rhsKey = rhsProperty.key;
    expect(rhsKey.type).toBe("Identifier");
    expect(rhsKey.name).toBe("x");

    // Check if findIdentifiers returned this specific node
    // Note: findIdentifiers modifies nodes in-place adding 'parent'.
    // The rhsKey node from findNode might not have 'parent' if findNode didn't add it.
    // However, findIdentifiers traverses the same AST object structure.
    // So the object identity should be the same.

    // But wait, findIdentifiers sets parent.
    // And shouldIgnoreIdentifier relies on parent.
    // If I just call findIdentifiers, it sets parents.

    const isIncluded = identifiers.includes(rhsKey as Identifier);
    expect(isIncluded).toBe(false);

    // Verify LHS identifiers are included
    const lhsBinding = identifiers.find(id => id.name === "x" && (id as any).parent?.type === "Property" && (id as any).parent.parent?.type === "ObjectPattern");
    expect(lhsBinding).toBeDefined();
  });

  it("should ignore property keys in destructuring assignment (AssignmentExpression)", () => {
    const code = `({ x } = { x: 2 });`;
    const ast = parseAst(code, "typescript");
    const identifiers = findIdentifiers(ast);

    // Find RHS key 'x'
    const rhsObject = findNode(ast, (n) => n.type === "ObjectExpression" && (n as any).properties?.length === 1 && (n as any).properties[0].value.type === "Literal") as any;
    expect(rhsObject).toBeDefined();

    const rhsKey = rhsObject.properties[0].key;
    const isIncluded = identifiers.includes(rhsKey as Identifier);
    expect(isIncluded).toBe(false);
  });

  it("should NOT ignore property keys in normal object assignment", () => {
    const code = `const o = { x: 2 };`;
    const ast = parseAst(code, "typescript");
    const identifiers = findIdentifiers(ast);

    const objectExpr = findNode(ast, (n) => n.type === "ObjectExpression") as any;
    expect(objectExpr).toBeDefined();
    const key = objectExpr.properties[0].key;

    const isIncluded = identifiers.includes(key as Identifier);
    expect(isIncluded).toBe(true);
  });

  it("should ignore property keys in destructuring assignment with shorthand", () => {
    const code = `const { x } = { x };`;
    const ast = parseAst(code, "typescript");
    const identifiers = findIdentifiers(ast);

    // RHS is { x } which is shorthand property. key is x, value is x.
    const rhsObject = findNode(ast, (n) => n.type === "ObjectExpression") as any;
    const property = rhsObject.properties[0];
    const key = property.key;
    const value = property.value;

    // key 'x' should be ignored
    expect(identifiers.includes(key as Identifier)).toBe(false);

    // value 'x' (reference) should be INCLUDED
    expect(identifiers.includes(value as Identifier)).toBe(true);
  });
});

