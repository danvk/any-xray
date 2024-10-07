import * as vscode from 'vscode';
import * as ts from 'typescript';
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

interface DetectedAnys {
	generation: number;
	anyRanges: vscode.Range[];
	checkedRanges: vscode.Range[];
}

const fileVersions: { [fileName: string]: number } = {};
const detectedAnys: { [fileName: string]: DetectedAnys } = {};

export async function activate(context: vscode.ExtensionContext) {
	console.log('any-xray: activate');
	loadConfiguration();

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
			// this is fired on every keystroke
			const {activeTextEditor} = vscode.window;
			const {document} = event;
			// TODO: is the activeTextEditor check helpful?
      if (document.languageId === 'typescript' && document === activeTextEditor?.document) {
				const fileName = document.uri.fsPath;
				fileVersions[fileName] = (fileVersions[fileName] || 0) + 1;
				delete detectedAnys[fileName];  // invalidate cache
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
		}),
  );

	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor?.document.languageId === 'typescript') {
			// console.log("onDidChangeActiveTextEditor");
			findTheAnysDebounced(editor.document, editor);
		}
	});

	vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
		// console.log('scroll!', event.visibleRanges);
		if (event.textEditor?.document.languageId === 'typescript') {
			findTheAnysDebounced(event.textEditor.document, event.textEditor);
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
	const generation = fileVersions[fileName] || 0;

	// Check if we've already checked the visible range.
	// Use this to determine which lines are visible
	// TODO: need to recompute when visible range changes
	// TODO: what are the other ranges?
	const visibleRange = editor.visibleRanges[0];
	const prev = detectedAnys[fileName];
	if (prev?.generation === generation) {
		if (prev.checkedRanges.some(range => range.contains(visibleRange))) {
			console.log('already checked visible range');
			editor.setDecorations(decorationType, prev.anyRanges);
			return;
		}
	}

	const parseStartMs = Date.now();
	const sourceFile = ts.createSourceFile(fileName, document.getText(), ts.ScriptTarget.Latest, false);
	console.log('parsed', fileName, 'in', Date.now() - parseStartMs, 'ms');
	// TODO: cache generation -> sourceFile	mapping for active editor

	const identifiers: ts.Identifier[] = [];

  function visit(node: ts.Node) {
		if (ts.isImportDeclaration(node)) {
			return;  // we want no part in these
		}
    if (ts.isIdentifier(node)) {
			// TODO: why does this need sourceFile? getFullStart() does not.
			const start = node.getStart(sourceFile);
			const end = node.getEnd();
			const range = new vscode.Range(document.positionAt(start), document.positionAt(end));

			// TODO: make sure that this range hasn't already been checked.
			if (visibleRange.contains(range)) {
				identifiers.push(node);
			}
		}

		// TODO: only descend into visible nodes
		ts.forEachChild(node, visit);
  }

  visit(sourceFile);
	console.log('checking quickinfo for', identifiers.length, 'identifiers');
	const startMs = Date.now();
	// TODO: batch these to let the user get some interactions in
	const anyRanges = (await Promise.all(identifiers.map(async (node) => {
		// TODO: why does this need sourceFile? getFullStart() does not.
		const start = node.getStart(sourceFile);
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

	const newGeneration = fileVersions[fileName] || 0;
	if (generation !== newGeneration) {
		console.log('ignoring stale quickinfo');
		return;
	}

	const oldDetected = detectedAnys[fileName];
	if (!oldDetected || oldDetected.generation !== generation) {
		detectedAnys[fileName] = {
			generation,
			anyRanges: anyRanges,
			checkedRanges: [visibleRange],
		};
	} else {
		oldDetected.anyRanges = oldDetected.anyRanges.concat(anyRanges);
		// TODO: merge ranges
		oldDetected.checkedRanges.push(visibleRange);
	}

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
