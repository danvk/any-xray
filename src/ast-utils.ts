import { parse as parseVue } from "vue-eslint-parser";
import type { AST as VueAST } from "vue-eslint-parser";
import { parse as parseTs } from "@typescript-eslint/parser";
import type { TSESTree } from "@typescript-eslint/types";
import { Interval, IntervalSet } from "./interval-set";

export type Identifier = (TSESTree.Identifier | VueAST.ESLintIdentifier) & {
  parent?: AstNode;
};
export type AstNode = (TSESTree.Node | VueAST.Node) & {
  parent?: AstNode | null | undefined;
};

export function parseAst(
  text: string,
  languageId: string,
): TSESTree.Program | VueAST.ESLintProgram {
  if (languageId === "vue") {
    return parseVue(text, {
      parser: "@typescript-eslint/parser",
      ecmaVersion: 2020,
      sourceType: "module",
    });
  } else {
    return parseTs(text, {
      loc: true,
      range: true,
      tokens: true,
      sourceType: "module",
      ecmaVersion: 2020,
    });
  }
}

export function shouldIgnoreIdentifier(node: Identifier): boolean {
  if (
    node.parent?.type === "Property" &&
    node.parent.parent?.type === "ObjectExpression" &&
    node.parent.key === node &&
    !node.parent.computed
  ) {
    const objectExpression = node.parent.parent as AstNode;
    const parent = objectExpression.parent;
    if (!parent) {
      return false;
    }

    if (
      parent.type === "VariableDeclarator" &&
      parent.id?.type === "ObjectPattern" &&
      parent.init === objectExpression
    ) {
      return true;
    }
    if (
      parent.type === "AssignmentExpression" &&
      parent.left?.type === "ObjectPattern" &&
      parent.right === objectExpression
    ) {
      return true;
    }
    if (
      parent.type === "AssignmentPattern" &&
      parent.left?.type === "ObjectPattern" &&
      parent.right === objectExpression
    ) {
      return true;
    }
  }
  return false;
}

export function findIdentifiers(
  ast: TSESTree.Program | VueAST.ESLintProgram,
  ivsToCheck?: IntervalSet,
): Identifier[] {
  const identifiers: Identifier[] = [];
  // Custom traversal for ESTree AST (works for both Vue and TypeScript-ESLint)
  const stack: {
    node: AstNode;
    parent?: AstNode;
  }[] = [{ node: ast as AstNode }];

  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    if (!node || typeof node !== "object") {
      continue;
    }
    node.parent = parent;

    if (node.loc && ivsToCheck) {
      const nodeIv: Interval = [node.loc.start.line, node.loc.end.line];
      if (!ivsToCheck.intersects(nodeIv)) {
        continue; // Prune branch if not in interesting range
      }
    }

    if (node.type === "Identifier") {
      if (!shouldIgnoreIdentifier(node as Identifier)) {
        identifiers.push(node as Identifier);
      }
    }

    for (const key in node) {
      if (
        key === "parent" ||
        key === "loc" ||
        key === "range" ||
        key === "tokens" ||
        key === "comments"
      ) {
        continue;
      }
      const val = (node as any)[key];
      if (Array.isArray(val)) {
        for (let i = val.length - 1; i >= 0; i--) {
          if (val[i] && typeof val[i] === "object" && val[i].type) {
            stack.push({
              node: val[i] as AstNode,
              parent: node,
            });
          }
        }
      } else if (val && typeof val === "object" && val.type) {
        stack.push({ node: val as AstNode, parent: node });
      }
    }
  }

  return identifiers;
}
