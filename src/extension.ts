import * as vscode from 'vscode';
import * as ts from 'typescript';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.languages.registerCodeActionsProvider('typescript', {
    provideCodeActions(document: vscode.TextDocument) {
      const diagnostics: vscode.Diagnostic[] = [];

      // Step 1: Create a TypeScript Program
      const fileName = document.uri.fsPath;
      const sourceCode = document.getText();

      // Create a SourceFile object
      const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.ES2020, true);

      // Create a CompilerHost to provide necessary functions to the compiler
      const compilerHost: ts.CompilerHost = {
        getSourceFile: (fileName, languageVersion) => {
          if (fileName === document.uri.fsPath) {
						return sourceFile;
					}
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

      // Create the Program
      const program = ts.createProgram([fileName], { noEmit: true }, compilerHost);

      // Get the TypeChecker
      const checker = program.getTypeChecker();

      // Step 2: Traverse the AST and find inferred any types
      function visit(node: ts.Node) {
        if (ts.isVariableDeclaration(node) && !node.type) {
          const symbol = checker.getSymbolAtLocation(node.name);
          if (symbol) {
            const type = checker.getTypeOfSymbolAtLocation(symbol, node);
            const typeString = checker.typeToString(type);

            if (typeString === 'any') {
              const start = node.getStart();
              const end = node.getEnd();
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

      return diagnostics;
    }
  });

  context.subscriptions.push(disposable);
}
