import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('typescript');

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'typescript') {
				console.log('here1');
        updateDiagnostics(event.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === 'typescript') {
				console.log('here2');
        updateDiagnostics(document);
      }
    })
  );

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
				console.log('here3');
				return [];
			}
		})
	);
}

function updateDiagnostics(document: vscode.TextDocument) {
	console.log('update diagnostics');
  const diagnostics: vscode.Diagnostic[] = [];

  // Step 1: Get workspace folder and tsconfig.json path
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
		console.log('no workspace folder!');
    return;
  }
	console.log('workspace folder', workspaceFolder.uri.fsPath);

  const tsConfigPath = path.join(workspaceFolder.uri.fsPath, 'tsconfig.json');
  if (!fs.existsSync(tsConfigPath)) {
    vscode.window.showWarningMessage('No tsconfig.json found in the workspace folder.');
    return;
  }
	console.log('tsconfig path', tsConfigPath);

  // Step 2: Parse tsconfig.json to get compiler options and file list
	let configParseResult;
	try {
		configParseResult = ts.parseJsonConfigFileContent(
			ts.parseConfigFileTextToJson(tsConfigPath, fs.readFileSync(tsConfigPath, 'utf8')).config,
			ts.sys,
			workspaceFolder.uri.fsPath
		);
	} catch (e) {
		console.error('failed to parse tsconfig.json', e);
		return;
	}

  // Step 3: Create the TypeScript Program with all files from tsconfig.json
  const program = ts.createProgram(configParseResult.fileNames, configParseResult.options);
	console.log('program files', configParseResult.fileNames);

  const checker = program.getTypeChecker();

  // Step 4: Traverse the AST of the current file and find inferred any types
  const sourceFile = program.getSourceFile(document.uri.fsPath);
  if (!sourceFile) {
		console.log('no source file!');
    return;
  }

  function visit(node: ts.Node) {
		console.log('visit');
    if (ts.isVariableDeclaration(node) && !node.type) {
			console.log('variable declaration', node.name.getText());
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        const type = checker.getTypeOfSymbolAtLocation(symbol, node);
        const typeString = checker.typeToString(type);
				console.log(node.name.getText(), typeString);

        // Check if the type is inferred as 'any'
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

  // Step 5: Apply diagnostics to the document
  diagnosticCollection.set(document.uri, diagnostics);
}

export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}
