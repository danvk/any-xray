import * as vscode from 'vscode';
import * as ts from 'typescript';
import debounce from 'lodash.debounce';
import { Interval, IntervalSet } from './interval-set';
import { isAny } from './is-any';

const configurationSection = 'anyXray';

let decorationType: vscode.TextEditorDecorationType;

const fallbackDecorationStyle: vscode.DecorationRenderOptions = {
	backgroundColor: "rgba(255,0,0,0.1)",
	borderRadius: "3px",
	border: "solid 1px rgba(255,0,0)",
	color: "red"
};

interface DetectedAnys {
	generation: number;
	anyRanges: vscode.Range[];
	/** IntervalSet of line numbers */
	checkedRanges: IntervalSet;
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
			// TODO: debouncing is only needed for getting quickinfo, not setting spans from cache
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
	const visibleRange = editor.visibleRanges[0];	// TODO: what are the other ranges?
	const visibleIv: Interval = [visibleRange.start.line, visibleRange.end.line];
	const prev = detectedAnys[fileName];
	let ivsToCheck: IntervalSet;
	if (prev?.generation === generation) {
		ivsToCheck = prev.checkedRanges.uncovered(visibleIv);
	} else {
		ivsToCheck = new IntervalSet([visibleIv]);
	}
	if (ivsToCheck.isEmpty()) {
		console.log('already checked visible range');
		editor.setDecorations(decorationType, prev.anyRanges);
		return;
	}

	const parseStartMs = Date.now();
	const sourceFile = ts.createSourceFile('/any-xray/' + fileName, document.getText(), ts.ScriptTarget.Latest, false);
	console.log('parsed', fileName, 'in', Date.now() - parseStartMs, 'ms');
	// TODO: cache generation -> sourceFile	mapping for active editor

	const identifiers: ts.Identifier[] = [];

  function visit(node: ts.Node) {
		if (ts.isImportDeclaration(node)) {
			return;  // we want no part in these
		}
		// TODO: why does this need sourceFile? getFullStart() does not.
		const start = node.getStart(sourceFile);
		const end = node.getEnd();
		const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
		const nodeIv: Interval = [range.start.line, range.end.line];
		if (!ivsToCheck.intersects(nodeIv)) {
			return;
		}
    if (ts.isIdentifier(node)) {
			identifiers.push(node);
		}
		ts.forEachChild(node, visit);
  }

  visit(sourceFile);
	console.log('checking quickinfo for', identifiers.length, 'identifiers in', JSON.stringify(ivsToCheck.getIntervals()));
	const startMs = Date.now();
	// TODO: batch these to let the user get some interactions in
	const anyRanges = (await Promise.all(identifiers.map(async (node) => {
		// TODO: why does this need sourceFile? getFullStart() does not.
		const start = node.getStart(sourceFile);
		const end = node.getEnd();
		const info = await quickInfoRequest(document, document.positionAt(start + 1));
		// console.log(node.getText(sourceFile), '->', info?.body?.displayString);
		if (isAny(info?.body?.displayString ?? '')) {
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
	let anyRangesToSet;
	if (!oldDetected || oldDetected.generation !== generation) {
		// console.log('setting new anyRanges', anyRanges.length);
		detectedAnys[fileName] = {
			generation,
			anyRanges: anyRanges,
			checkedRanges: new IntervalSet([visibleIv]),
		};
		anyRangesToSet = anyRanges;
	} else {
		// console.log('concatenating to old anyRanges', oldDetected.anyRanges.length, '+', anyRanges.length);
		oldDetected.anyRanges = anyRangesToSet = oldDetected.anyRanges.concat(anyRanges);
		oldDetected.checkedRanges.add(visibleIv);
	}

	editor.setDecorations(decorationType, anyRangesToSet);
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
