import * as vscode from 'vscode';
import * as ts from 'typescript';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  // Create a diagnostic collection for TypeScript files
  diagnosticCollection = vscode.languages.createDiagnosticCollection('typescript');

  // Register the diagnostic collection for TypeScript files
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'typescript') {
        updateDiagnostics(event.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === 'typescript') {
        updateDiagnostics(document);
      }
    })
  );

  // Clean up diagnostics when a document is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticCollection.delete(document.uri);
    })
  );

  // Register the code action provider (even though it won't return actions yet)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider('typescript', {
      provideCodeActions: (document, range, context, token) => {
        // For now, we are not returning any code actions, just showing diagnostics
        return [];
      }
    })
  );
}

function updateDiagnostics(document: vscode.TextDocument) {
  const diagnostics: vscode.Diagnostic[] = [];

  // Step 1: Create a TypeScript Program
  const fileName = document.uri.fsPath;
  const sourceCode = document.getText();

  const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.ES2020, true);

  const compilerHost: ts.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      if (fileName === document.uri.fsPath) return sourceFile;
      return undefined;
    },
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    writeFile: (fileName, content) => {},
    getCurrentDirectory: () => "",
    getDirectories: (path) => [],
    getCanonicalFileName: (fileName) => fileName,
    getNewLine: () => "\n",
    useCaseSensitiveFileNames: () => true,
    fileExists: (fileName) => fileName === document.uri.fsPath,
    readFile: (fileName) => fileName === document.uri.fsPath ? sourceCode : undefined
  };

  const program = ts.createProgram([fileName], { noEmit: true }, compilerHost);
  const checker = program.getTypeChecker();

  // Step 2: Traverse the AST and find inferred any types
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && !node.type) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        const type = checker.getTypeOfSymbolAtLocation(symbol, node);
        const typeString = checker.typeToString(type);

        if (typeString === 'any') {
          const start = node.name.getStart();
          const end = node.name.getEnd();
          const range = new vscode.Range(document.positionAt(start), document.positionAt(end));

          const diagnostic = new vscode.Diagnostic(
            range,
            `Variable "${node.name.getText()}" is inferred as 'any'`,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostics.push(diagnostic);
        }
      }
    }
    node.forEachChild(visit);
  }

  visit(sourceFile);

  // Apply the diagnostics to the document
  diagnosticCollection.set(document.uri, diagnostics);
}

export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}
