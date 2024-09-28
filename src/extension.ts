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
      if (fileName === document.uri.fsPath) {
				// console.log('getSourceFile hit', fileName);
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
    fileExists: (fileName) => {
			// console.log('fileExists', fileName === document.uri.fsPath, fileName);
			return fileName === document.uri.fsPath;
		},
    readFile: (fileName) => {
			// console.log('readFile', fileName === document.uri.fsPath);
			return fileName === document.uri.fsPath ? sourceCode : undefined;
		}
  };

  const program = ts.createProgram([fileName], { noEmit: true }, compilerHost);
  const checker = program.getTypeChecker();
	// const languageService = ts.createLanguageService(getLanguageServiceHost(program));

  // Step 2: Traverse the AST and find inferred any types
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) {
			const id = node;
      const symbol = checker.getSymbolAtLocation(id);
      if (symbol) {
				const type = getContextualType(checker, node);
				if (!type) {
					console.log('no type', id.getText());
					return;
				}
        // const type = checker.getTypeOfSymbolAtLocation(symbol, id);
        const typeString = checker.typeToString(type);
				console.log('id', id.getText(), typeString);

        if (typeString === 'any') {
					const start = id.getStart();
					const end = id.getEnd();
					const range = new vscode.Range(document.positionAt(start), document.positionAt(end));

					const diagnostic = new vscode.Diagnostic(
						range,
						`Variable "${id.getText()}" is inferred as 'any'`,
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

// See https://github.com/JoshuaKGoldberg/eslint-plugin-expect-type/blob/a55413/src/rules/expect.ts#L506-L521
function getLanguageServiceHost(program: ts.Program): ts.LanguageServiceHost {
  return {
    getCompilationSettings: () => program.getCompilerOptions(),
    getCurrentDirectory: () => program.getCurrentDirectory(),
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => program.getSourceFiles().map(sourceFile => sourceFile.fileName),
    getScriptSnapshot: name =>
      ts.ScriptSnapshot.fromString(program.getSourceFile(name)?.text ?? ''),
    getScriptVersion: () => '1',
    // NB: We can't check `program` for files, it won't contain valid files like package.json
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
}

// https://github.com/typescript-eslint/typescript-eslint/blob/94c5484f747be901f1610fc37192714a619bb355/packages/type-utils/src/getContextualType.ts#L8
/**
 * Returns the contextual type of a given node.
 * Contextual type is the type of the target the node is going into.
 * i.e. the type of a called function's parameter, or the defined type of a variable declaration
 */
export function getContextualType(
  checker: ts.TypeChecker,
  node: ts.Expression,
): ts.Type | undefined {
  const parent = node.parent;

  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    if (node === parent.expression) {
      // is the callee, so has no contextual type
      return;
    }
  } else if (
    ts.isVariableDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isParameter(parent)
  ) {
    return parent.type ? checker.getTypeFromTypeNode(parent.type) : undefined;
  } else if (ts.isJsxExpression(parent)) {
    return checker.getContextualType(parent);
  } else if (
    ts.isIdentifier(node) &&
    (ts.isPropertyAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent))
  ) {
    return checker.getContextualType(node);
  } else if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === node
  ) {
    // is RHS of assignment
    return checker.getTypeAtLocation(parent.left);
  } else if (
    ![ts.SyntaxKind.TemplateSpan, ts.SyntaxKind.JsxExpression].includes(
      parent.kind,
    )
  ) {
    // parent is not something we know we can get the contextual type of
    return;
  }
  // TODO - support return statement checking

  return checker.getContextualType(node);
}
