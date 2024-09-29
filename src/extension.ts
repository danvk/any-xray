import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import * as _ from 'lodash';

const decorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(255,0,0,0.1)', // Red translucent highlight
	borderRadius: '3px',
	border: 'solid 1px rgba(255,0,0)',
	color: 'red',
});

const errorType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(255,255,0,0.25)',
	borderRadius: '3px',
	border: 'solid 2px rgba(255,255,0)',
});

let languageService: ts.LanguageService;
let fileVersions: { [fileName: string]: number } = {};
let fileSnapshot: { [fileName: string]: ts.IScriptSnapshot } = {};

export async function activate(context: vscode.ExtensionContext) {
	console.log('activate');

  setupLanguageService();

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
			// this is fired on every keystroke
			const {activeTextEditor} = vscode.window;
      if (event.document.languageId === 'typescript' && event.document === activeTextEditor?.document) {
        findTheAnyDebounced(event.document, activeTextEditor);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
			const {activeTextEditor} = vscode.window;
      if (document.languageId === 'typescript' && document === activeTextEditor?.document) {
				console.log('onDidOpenTextDocument');
        findTheAnyDebounced(document, activeTextEditor);
      }
    }),
		vscode.workspace.onDidCloseTextDocument((document) => {
			delete fileVersions[document.uri.fsPath];
			delete fileSnapshot[document.uri.fsPath];
		}),
  );

	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor?.document.languageId === 'typescript') {
			console.log("onDidChangeActiveTextEditor");
			findTheAnyDebounced(editor.document, editor);
		}
	});

	const visibleUris = new Set<string>();
	for (const group of vscode.window.tabGroups.all) {
		const {activeTab} = group;
		if (!activeTab) {
			return;
		}
		const {input} = activeTab;
		if (input && typeof input === 'object' && 'uri' in input) {
			const textInput = input as vscode.TabInputText;
			visibleUris.add(textInput.uri.fsPath);
		}
	}
	console.log('num visible URIs:', visibleUris.size);

	// TODO: is there some kind of "idle" event I can use instead of this?
	setTimeout(() => {
		vscode.window.visibleTextEditors.forEach((editor) => {
			if (editor.document.languageId === 'typescript' && visibleUris.has(editor.document.uri.fsPath)) {
				console.log('initial pass for', editor.document.uri.fsPath);
				findTheAnys(editor.document, editor);
			}
		});
	}, 0);
}

function findTheAnys(document: vscode.TextDocument, editor: vscode.TextEditor) {
	const fileName = document.uri.fsPath;
  fileVersions[fileName] = (fileVersions[fileName] || 0) + 1;

  const sourceCode = document.getText();
  const scriptSnapshot = ts.ScriptSnapshot.fromString(sourceCode);
	// TODO: purge this after the file is saved?
	fileSnapshot[fileName] = scriptSnapshot;

  // Step 6: Analyze the file using the Language Service
  const program = languageService.getProgram();
  if (!program) {
		console.warn('no program');
		return;
	}

  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) {
		console.warn('no source file');
		return;
	}

  const checker = program.getTypeChecker();

	const matches: vscode.DecorationOptions[] = [];
	const errors: vscode.DecorationOptions[] = [];
  function visit(node: ts.Node) {
		if (ts.isImportDeclaration(node)) {
			return;  // we want no part in these
		}
    if (ts.isIdentifier(node)) {
			const type = checker.getTypeAtLocation(node);
			const typeString = checker.typeToString(type);

			// Check if the type is inferred as 'any'
			if (typeString === 'any' && !ts.isTypePredicateNode(node.parent)) {
				const start = node.getStart();
				const end = node.getEnd();
				const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
				if (type.intrinsicName === 'error') {
					errors.push({range});
				} else {
					matches.push({range});
				}
			}
		}
    node.forEachChild(visit);
  }

  visit(sourceFile);
	editor.setDecorations(decorationType, matches);
	editor.setDecorations(errorType, errors);
}

const findTheAnyDebounced = _.debounce(findTheAnys, 250);

export function deactivate() {
	console.log('deactivate');
}

function setupLanguageService() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found.');
    return;
  }

  const tsConfigPath = path.join(workspaceFolder, 'tsconfig.json');
  if (!fs.existsSync(tsConfigPath)) {
    vscode.window.showWarningMessage('No tsconfig.json found in the workspace folder.');
    return;
  }

  // Step 2: Parse tsconfig.json to get compiler options and file list
	let config;
	try {
		config = ts.parseJsonConfigFileContent(
			ts.parseConfigFileTextToJson(tsConfigPath, fs.readFileSync(tsConfigPath, 'utf8')).config,
			ts.sys,
			workspaceFolder
		);
	} catch (e) {
		vscode.window.showWarningMessage('Failed to load tsconfig.json');
		return;
	}
	if (config.errors.length) {
		vscode.window.showWarningMessage(`tsconfig.json errors ${config.errors}`);
	}

  // Step 3: Create a script snapshot and set up Language Service host
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => config.fileNames,
    getScriptVersion: (fileName) => fileVersions[fileName]?.toString() ?? '0',
    getScriptSnapshot: (fileName) => {
			const snap = (fileSnapshot[fileName]);
			if (snap) {
				return snap;
			}
      if (fs.existsSync(fileName)) {
        return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
      }
      return undefined;
    },
    getCurrentDirectory: () => workspaceFolder,
    getCompilationSettings: () => config.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
		readFile: ts.sys.readFile,
		fileExists: ts.sys.fileExists,
  };

  // Step 4: Create the TypeScript Language Service
  languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
}
