import * as vscode from "vscode";
import type * as ts from "typescript";
import { parse as parseVue } from "vue-eslint-parser";
import type { AST as VueAST } from "vue-eslint-parser";
import { parse as parseTs } from "@typescript-eslint/parser";
import type { TSESTree } from "@typescript-eslint/types";
import debounce from "lodash.debounce";
import { Interval, IntervalSet } from "./interval-set";
import { isAny } from "./is-any";

const configurationSection = "anyXray";

let decorationType: vscode.TextEditorDecorationType;

const fallbackDecorationStyle: vscode.DecorationRenderOptions = {
  backgroundColor: "rgba(255,0,0,0.1)",
  borderRadius: "3px",
  border: "solid 1px rgba(255,0,0)",
  color: "red",
};

interface DetectedAnys {
  generation: number;
  anyRanges: vscode.Range[];
  /** IntervalSet of line numbers */
  checkedRanges: IntervalSet;
}

type Identifier = TSESTree.Identifier | VueAST.ESLintIdentifier;

interface CachedAst {
  fileName: string;
  generation: number;
  languageId: string;
  ast: TSESTree.Program | VueAST.ESLintProgram; // ESTree-compatible AST
}
let cachedAst: CachedAst | null = null;

function isTypeScript(document: vscode.TextDocument) {
  if (
    document.languageId === "typescript" ||
    document.languageId === "typescriptreact"
  ) {
    return true;
  }

  // Check if Vue file uses TypeScript
  if (document.languageId === "vue") {
    const text = document.getText();
    return /<script[^>]*lang=["']ts["']/i.test(text);
  }

  return false;
}

const fileVersions: { [fileName: string]: number } = {};
const detectedAnys: { [fileName: string]: DetectedAnys } = {};
const tsErrorRanges: { [fileName: string]: vscode.Range[] } = {};

function updateDecorations(editor: vscode.TextEditor) {
  const fileName = editor.document.uri.fsPath;
  const detected = detectedAnys[fileName];
  if (!detected) {
    editor.setDecorations(decorationType, []);
    return;
  }

  const errors = tsErrorRanges[fileName] || [];
  const rangesToSet = detected.anyRanges.filter((anyRange) => {
    return !errors.some((errorRange) => errorRange.intersection(anyRange));
  });

  editor.setDecorations(decorationType, rangesToSet);
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("any-xray: activate");
  loadConfiguration();

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      // this is fired on every keystroke
      const { activeTextEditor } = vscode.window;
      const { document } = event;
      console.log(document.fileName, document.languageId);
      if (isTypeScript(document) && document === activeTextEditor?.document) {
        const fileName = document.uri.fsPath;
        fileVersions[fileName] = (fileVersions[fileName] || 0) + 1;
        delete detectedAnys[fileName]; // invalidate cache
        findTheAnysDebounced(event.document, activeTextEditor);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      const { activeTextEditor } = vscode.window;
      if (isTypeScript(document) && document === activeTextEditor?.document) {
        // console.log('onDidOpenTextDocument');
        findTheAnysDebounced(document, activeTextEditor);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      delete fileVersions[document.uri.fsPath];
    }),
  );

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && isTypeScript(editor.document)) {
      // console.log("onDidChangeActiveTextEditor");
      findTheAnysDebounced(editor.document, editor);
    }
  });

  vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
    // console.log('scroll!', event.visibleRanges);
    if (event.textEditor && isTypeScript(event.textEditor.document)) {
      // TODO: debouncing is only needed for getting quickinfo, not setting spans from cache
      findTheAnysDebounced(event.textEditor.document, event.textEditor);
    }
  });

  const updateVisibleEditors = () => {
    const visibleUris = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      const { activeTab } = group;
      if (!activeTab) {
        return;
      }
      const { input } = activeTab;
      if (input && typeof input === "object" && "uri" in input) {
        const textInput = input as vscode.TabInputText;
        visibleUris.add(textInput.uri.fsPath);
      }
    }
    vscode.window.visibleTextEditors.forEach((editor) => {
      if (
        isTypeScript(editor.document) &&
        visibleUris.has(editor.document.uri.fsPath)
      ) {
        // console.log('initial pass for', editor.document.uri.fsPath);
        findTheAnys(editor.document, editor);
      }
    });
  };

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(configurationSection)) {
      loadConfiguration();
      updateVisibleEditors();
    }
  });

  vscode.languages.onDidChangeDiagnostics((e) => {
    for (const uri of e.uris) {
      if (uri.scheme === "file") {
        const fileName = uri.fsPath;
        const diagnostics = vscode.languages.getDiagnostics(uri);
        const errorRanges = diagnostics
          .filter(
            (d) =>
              (d.source === "ts" || d.source === "typescript") &&
              d.severity === vscode.DiagnosticSeverity.Error,
          )
          .map((d) => d.range);
        tsErrorRanges[fileName] = errorRanges;

        vscode.window.visibleTextEditors.forEach((editor) => {
          if (editor.document.uri.fsPath === fileName) {
            updateDecorations(editor);
          }
        });
      }
    }
  });

  // TODO: is there some kind of "idle" event I can use instead of this?
  // setTimeout(updateVisibleEditors, 1000);
}

async function findTheAnys(
  document: vscode.TextDocument,
  editor: vscode.TextEditor,
) {
  const fileName = document.uri.fsPath;
  const generation = fileVersions[fileName] || 0;

  // Check if we've already checked the visible range.
  const visibleRange = editor.visibleRanges[0]; // TODO: what are the other ranges?
  const visibleIv: Interval = [visibleRange.start.line, visibleRange.end.line];
  const prev = detectedAnys[fileName];
  let ivsToCheck: IntervalSet;
  if (prev?.generation === generation) {
    ivsToCheck = prev.checkedRanges.uncovered(visibleIv);
  } else {
    ivsToCheck = new IntervalSet([visibleIv]);
  }
  if (ivsToCheck.isEmpty()) {
    // console.log('already checked visible range');
    updateDecorations(editor);
    return;
  }

  let ast: TSESTree.Program | VueAST.ESLintProgram;
  if (
    cachedAst &&
    cachedAst.fileName === fileName &&
    cachedAst.generation === generation &&
    cachedAst.languageId === document.languageId
  ) {
    ast = cachedAst.ast;
    // console.log('re-using cached AST');
  } else {
    const parseStartMs = Date.now();
    let parsedAst: TSESTree.Program | VueAST.ESLintProgram;
    if (document.languageId === "vue") {
      parsedAst = parseVue(document.getText(), {
        parser: "@typescript-eslint/parser",
        ecmaVersion: 2020,
        sourceType: "module",
      });
    } else {
      parsedAst = parseTs(document.getText(), {
        loc: true,
        range: true,
        tokens: true,
        sourceType: "module",
        ecmaVersion: 2020,
      });
    }
    const elapsedMs = Date.now() - parseStartMs;
    if (elapsedMs > 50) {
      console.log("parsed", fileName, "in", elapsedMs, "ms");
    }
    cachedAst = {
      fileName,
      generation,
      languageId: document.languageId,
      ast: parsedAst,
    };
    ast = parsedAst;
  }

  const identifiers: Identifier[] = [];
  // Custom traversal for ESTree AST (works for both Vue and TypeScript-ESLint)
  const stack: {
    node: TSESTree.Node | VueAST.Node;
    parent?: TSESTree.Node | VueAST.Node;
  }[] = [{ node: ast }];
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    if (!node || typeof node !== "object") {
      continue;
    }
    (node as any).parent = parent;

    if (node.loc) {
      const nodeIv: Interval = [node.loc.start.line, node.loc.end.line];
      if (!ivsToCheck.intersects(nodeIv)) {
        continue; // Prune branch if not in interesting range
      }
    }

    if (node.type === "Identifier") {
      if (!shouldIgnoreIdentifier(node)) {
        identifiers.push(node);
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
              node: val[i] as TSESTree.Node | VueAST.Node,
              parent: node,
            });
          }
        }
      } else if (val && typeof val === "object" && val.type) {
        stack.push({ node: val as TSESTree.Node | VueAST.Node, parent: node });
      }
    }
  }
  // TODO: cache generation -> AST mapping for active editor

  // console.log('checking quickinfo for', identifiers.length, 'identifiers in', JSON.stringify(ivsToCheck.getIntervals()));
  const startMs = Date.now();
  // TODO: batch these to let the user get some interactions in
  const anyRanges = (
    await Promise.all(
      identifiers.map(async (node) => {
        const loc = node.loc!;
        const { start } = loc;
        const pos = new vscode.Position(start.line, start.column + 1); // may need start.column+1
        const info = await quickInfoRequest(document, pos);
        if (isAny(info?.body?.displayString ?? "")) {
          console.log(
            "found an any",
            node.name,
            "->",
            info?.body?.displayString,
          );
          const { end } = loc;
          const startPos = new vscode.Position(start.line - 1, start.column);
          const endPos = new vscode.Position(end.line - 1, end.column);
          const range = new vscode.Range(startPos, endPos);
          return range;
        }
      }),
    )
  ).filter((x) => !!x);
  console.log(
    "checked quickinfo for ",
    identifiers.length,
    "identifers in",
    JSON.stringify(ivsToCheck.getIntervals()),
    "in",
    Date.now() - startMs,
    "ms",
  );

  const newGeneration = fileVersions[fileName] || 0;
  if (generation !== newGeneration) {
    console.log("ignoring stale quickinfo");
    return;
  }

  const oldDetected = detectedAnys[fileName];
  if (!oldDetected || oldDetected.generation !== generation) {
    // console.log('setting new anyRanges', anyRanges.length);
    detectedAnys[fileName] = {
      generation,
      anyRanges: anyRanges,
      checkedRanges: new IntervalSet([visibleIv]),
    };
  } else {
    // console.log('concatenating to old anyRanges', oldDetected.anyRanges.length, '+', anyRanges.length);
    oldDetected.anyRanges = oldDetected.anyRanges.concat(anyRanges);
    oldDetected.checkedRanges.add(visibleIv);
  }

  updateDecorations(editor);
  // editor.setDecorations(errorType, errors);
}

const findTheAnysDebounced = debounce(findTheAnys, 250);

function loadConfiguration() {
  const config = vscode.workspace.getConfiguration(configurationSection);
  const configStyle =
    config.get("anyStyle") ??
    (fallbackDecorationStyle as vscode.DecorationRenderOptions);
  if (decorationType) {
    decorationType.dispose();
  }
  try {
    decorationType = vscode.window.createTextEditorDecorationType(configStyle);
  } catch (e) {
    vscode.window.showErrorMessage(
      "Invalid anyXray.anyStyle; falling back to default.",
    );
    decorationType = vscode.window.createTextEditorDecorationType(
      fallbackDecorationStyle,
    );
  }
}

export function deactivate() {
  for (const key of Object.keys(detectedAnys)) {
    delete detectedAnys[key];
  }
  for (const key of Object.keys(fileVersions)) {
    delete fileVersions[key];
  }
}

function shouldIgnoreIdentifier(node: any): boolean {
  if (
    node.parent?.type === "Property" &&
    node.parent.parent?.type === "ObjectExpression" &&
    node.parent.key === node &&
    !node.parent.computed
  ) {
    const objectExpression = node.parent.parent;
    const parent = objectExpression.parent;
    if (!parent) return false;

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

// See https://github.com/orta/vscode-twoslash-queries/blob/4a564ada9543517ea8419896637c737229109ac5/src/helpers.ts#L6-L18
/** Leverages the `tsserver` protocol to try to get the type info at the given `position`. */
async function quickInfoRequest(
  doc: vscode.TextDocument,
  position: vscode.Position,
) {
  const { scheme, fsPath, authority, path } = doc.uri;
  const req: ts.server.protocol.FileLocationRequestArgs = {
    file:
      scheme === "file"
        ? fsPath
        : `^/${scheme}/${authority || "ts-nul-authority"}/${path.replace(/^\//, "")}`,
    line: position.line,
    offset: position.character,
  };
  return vscode.commands.executeCommand<
    ts.server.protocol.QuickInfoResponse | undefined
  >("typescript.tsserverRequest", "quickinfo", req);
}
