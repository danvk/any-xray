import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

const decorationType = vscode.window.createTextEditorDecorationType({
  // backgroundColor: 'rgba(255,0,0,0.1)', // Red translucent highlight
	// borderRadius: '3px',
	// border: 'solid 1px rgba(255,0,0)',
	color: 'red',
});

export function activate(context: vscode.ExtensionContext) {
	console.log('activate');

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'typescript') {
        findTheAnys(event.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === 'typescript') {
        findTheAnys(document);
      }
    })
  );
}

function findTheAnys(document: vscode.TextDocument) {
  // Step 1: Get workspace folder and tsconfig.json path
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) {
    return;
  }

  const tsConfigPath = path.join(workspaceFolder.uri.fsPath, 'tsconfig.json');
  if (!fs.existsSync(tsConfigPath)) {
    vscode.window.showWarningMessage('No tsconfig.json found in the workspace folder.');
    return;
  }

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

  const checker = program.getTypeChecker();

  // Step 4: Traverse the AST of the current file and find inferred any types
  const sourceFile = program.getSourceFile(document.uri.fsPath);
  if (!sourceFile) {
    return;
  }
	const matches: vscode.DecorationOptions[] = [];
  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) {
			const type = checker.getTypeAtLocation(node);
			const typeString = checker.typeToString(type);
			// console.log(node.getText(), typeString);

			// Check if the type is inferred as 'any'
			if (typeString === 'any' && !ts.isTypePredicateNode(node.parent)) {
				const start = node.getStart();
				const end = node.getEnd();
				const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
				matches.push({range});
			}
		}
    node.forEachChild(visit);
  }

  visit(sourceFile);
	const editor = vscode.window.activeTextEditor;
	if (editor?.document === document) {
		editor.setDecorations(decorationType, matches);
	}
}

export function deactivate() {
	console.log('deactivate');
}
