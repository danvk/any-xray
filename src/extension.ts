import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import debounce from 'lodash.debounce';

const configurationSection = 'anyXray';

let decorationType: vscode.TextEditorDecorationType;
let showErrors = false;

const errorType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(255,255,0,0.25)',
	borderRadius: '3px',
	border: 'solid 2px rgba(255,255,0)',
});

const fallbackDecorationStyle: vscode.DecorationRenderOptions = {
	backgroundColor: "rgba(255,0,0,0.1)",
	borderRadius: "3px",
	border: "solid 1px rgba(255,0,0)",
	color: "red"
};

let languageService: ts.LanguageService;
let fileVersions: { [fileName: string]: number } = {};
let fileSnapshot: { [fileName: string]: ts.IScriptSnapshot } = {};

export async function activate(context: vscode.ExtensionContext) {
	console.log('any-xray: activate');
	loadConfiguration();
  setupLanguageService();

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
			// this is fired on every keystroke
			const {activeTextEditor} = vscode.window;
      if (event.document.languageId === 'typescript' && event.document === activeTextEditor?.document) {
        findTheAnysDebounced(event.document, activeTextEditor);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
			const {activeTextEditor} = vscode.window;
      if (document.languageId === 'typescript' && document === activeTextEditor?.document) {
				// console.log('onDidOpenTextDocument');
        findTheAnysDebounced(document, activeTextEditor);
      }
    }),
		vscode.workspace.onDidCloseTextDocument((document) => {
			delete fileVersions[document.uri.fsPath];
			delete fileSnapshot[document.uri.fsPath];
		}),
  );

	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor?.document.languageId === 'typescript') {
			// console.log("onDidChangeActiveTextEditor");
			findTheAnysDebounced(editor.document, editor);
		}
	});

	const updateVisibleEditors = () => {
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
		vscode.window.visibleTextEditors.forEach((editor) => {
			if (editor.document.languageId === 'typescript' && visibleUris.has(editor.document.uri.fsPath)) {
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

	// TODO: is there some kind of "idle" event I can use instead of this?
	setTimeout(updateVisibleEditors, 0);
}

async function findTheAnys(document: vscode.TextDocument, editor: vscode.TextEditor) {
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
	console.log('any-xray program cwd', program.getCurrentDirectory());

  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) {
		console.warn('no source file');
		return;
	}

	// Use this to determine which line are visible
	// TODO: need to recompute when visible range changes
	const ranges = editor.visibleRanges;

	const identifiers: ts.Identifier[] = [];

  function visit(node: ts.Node) {
		if (ts.isImportDeclaration(node)) {
			return;  // we want no part in these
		}
    if (ts.isIdentifier(node)) {
			const start = node.getStart();
			const end = node.getEnd();
			const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
			// TODO: what are the other ranges?
			if (ranges[0].contains(range)) {
				identifiers.push(node);
			}
		}

    node.forEachChild(visit);
  }
			/*
			const type = checker.getTypeAtLocation(node);
			const typeString = checker.typeToString(type);

			// Check if the type is inferred as 'any'
			if (typeString === 'any' && !ts.isTypePredicateNode(node.parent)) {
				const start = node.getStart();
				const end = node.getEnd();
				const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
				if (type.intrinsicName === 'error') {
					if (showErrors) {
						errors.push({range});
					}
				} else {
					identifiers.push(node);
					const txt = node.getText();
					matches.push({range});
					const startMs = Date.now();
					quickInfoRequest(document, document.positionAt(start + 1)).then((info) => {
						const elapsedMs = Date.now() - startMs;
						console.log(txt, '->', info, elapsedMs, 'ms');
						if (info?.body?.displayString.endsWith(': any')) {

						}
					});
				}
			}
		}
		*/
  visit(sourceFile);
	console.log('checking quickinfo for', identifiers.length, 'identifiers');
	const startMs = Date.now();
	const anyRanges = (await Promise.all(identifiers.map(async (node) => {
		const start = node.getStart();
		const end = node.getEnd();
		// const startMs = Date.now();
		const info = await quickInfoRequest(document, document.positionAt(start + 1));
		// const elapsedMs = Date.now() - startMs;
		// console.log(node.getText(), '->', info?.body?.displayString, elapsedMs, 'ms');
		// TODO: test this / make it more robust
		if (info?.body?.displayString.match(/[^)]: any$/)) {
			const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
			return range;
		}
	}))).filter(x => !!x);
	console.log('checked quickinfo for ', identifiers.length, 'identifers in', Date.now() - startMs, 'ms');

	// const matches: vscode.DecorationOptions[] = [];
	// const errors: vscode.DecorationOptions[] = [];
	editor.setDecorations(decorationType, anyRanges);
	// editor.setDecorations(errorType, errors);
}

const findTheAnysDebounced = debounce(findTheAnys, 250);

function loadConfiguration() {
	console.log('any-xray: loading configuration');
	const config = vscode.workspace.getConfiguration(configurationSection);
	const configStyle = config.get('anyStyle') ?? fallbackDecorationStyle as vscode.DecorationRenderOptions;
	if (decorationType) {
		decorationType.dispose();
	}
	try {
		decorationType = vscode.window.createTextEditorDecorationType(configStyle);
	} catch (e) {
		vscode.window.showErrorMessage('Invalid anyXray.anyStyle; falling back to default.');
		decorationType = vscode.window.createTextEditorDecorationType(fallbackDecorationStyle);
	}

	showErrors = config.get('renderErrorAnys') as boolean;
}

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
	console.log('any-xray workspace:', workspaceFolder, 'tsconfig:', tsConfigPath);

  // Step 2: Parse tsconfig.json to get compiler options and file list
	let config;
	try {
		config = ts.parseJsonConfigFileContent(
			ts.parseConfigFileTextToJson(tsConfigPath, fs.readFileSync(tsConfigPath, 'utf8')).config,
			ts.sys,
			workspaceFolder,
			undefined,
			tsConfigPath
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
			// console.log('any-xray getScriptSnapshot', fileName);
			const snap = (fileSnapshot[fileName]);
			if (snap) {
				return snap;
			}
      if (fs.existsSync(fileName)) {
        return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
      }
			console.log('no snapshot for', fileName);
      return undefined;
    },
    getCurrentDirectory: () => workspaceFolder,
    getCompilationSettings: () => config.options,
		getDefaultLibFileName: (options) => {
			// getDefaultLibFilePath returns a path relative to the version of TypeScript that this
			// extension bundles. When it's distributed, this will not include the various lib.d.ts
			// files. Presumably these _are_ available in the workspace, so we try to reference those
			// instead. This feels like maybe not the right way to do this.
			const initPath = ts.getDefaultLibFilePath(options);
			const relativePath = initPath.replace(/.*node_modules/, 'node_modules');
			const libPath = path.join(workspaceFolder, relativePath);
			console.log('any-xray: changed ', initPath, 'to', libPath);
			if (!ts.sys.fileExists(libPath)) {
				console.warn('any-xray: lib file', libPath, 'does not exist');
			}
			return libPath;
		},
		readFile: ts.sys.readFile,
		fileExists: ts.sys.fileExists,
		getDirectories: ts.sys.getDirectories,
		readDirectory: ts.sys.readDirectory,
		directoryExists: ts.sys.directoryExists,
  };

  // Step 4: Create the TypeScript Language Service
  languageService = ts.createLanguageService(host, ts.createDocumentRegistry());
}

type Model = vscode.TextDocument;

/** Leverages the `tsserver` protocol to try to get the type info at the given `position`. */
async function quickInfoRequest(model: Model, position: vscode.Position) {
  const { scheme, fsPath, authority, path } = model.uri;
	const req: ts.server.protocol.FileLocationRequestArgs = {
		file: scheme === 'file' ? fsPath : `^/${scheme}/${authority || 'ts-nul-authority'}/${path.replace(/^\//, '')}`,
		line: position.line + 1,
		offset: position.character,
	};
  return await vscode.commands.executeCommand<ts.server.protocol.QuickInfoResponse | undefined>(
    "typescript.tsserverRequest",
    "quickinfo",
    req
  );
}
