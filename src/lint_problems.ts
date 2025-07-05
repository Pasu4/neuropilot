import * as vscode from 'vscode';
import { NEURO } from './constants';
import { normalizePath, getWorkspacePath, logOutput, isPathNeuroSafe } from './utils';
import { PERMISSIONS, getPermissionLevel, CONFIG } from './config';
import { ActionData, actionValidationAccept, actionValidationFailure, ActionValidationResult, RCEAction, contextFailure, stripToActions } from './neuro_client_helper';
import assert from 'node:assert';

/**
 * The path validator.
 * @param path The relative path to the file/folder.
 * @param directoryType What type of directory it is. 
 * @returns An {@link ActionValidationResult}. {@link actionValidationFailure} if any validation steps fail, {@link actionValidationAccept} otherwise.
 */
async function validatePath(path: string, directoryType: string): Promise<ActionValidationResult> {
    if (path === '') {
        return actionValidationFailure('No file path specified.', true);
    };
    const absolutePath = getWorkspacePath() + '/' + normalizePath(path).replace(/^\/|\/$/g, '');
    if (!isPathNeuroSafe(absolutePath)) {
        return actionValidationFailure(`You are not allowed to access this ${directoryType}.`);
    }

    const existence = await getPathExistence(absolutePath);
    if (existence === false) {
        return actionValidationFailure(`${directoryType} "${path}" does not exist.`);
    }

    return actionValidationAccept();
};

async function getPathExistence(absolutePath: string): Promise<boolean> {
    const pathAsUri = vscode.Uri.file(absolutePath);
    try {
        await vscode.workspace.fs.stat(pathAsUri);
        return true;
    } catch {
        return false;
    }
}

async function validateDirectoryAccess(actionData: ActionData): Promise<ActionValidationResult> {
    const workspacePath = getWorkspacePath();
    if (!workspacePath) {
        return actionValidationFailure('Unable to get current workspace.');
    }

    if (actionData.params?.file) {
        const relativePath = actionData.params.file;
        const check = await validatePath(relativePath, 'file');
        if (!check.success) return check;
    }
    if (actionData.params?.folder) {
        const relativePath = actionData.params.folder;
        const check = await validatePath(relativePath, 'folder');
        if (!check.success) return check;
    }

    return actionValidationAccept();
}

export const lintActions = {
    get_file_lint_problems: {
        name: 'get_file_lint_problems',
        description: 'Gets linting diagnostics for a file.',
        schema: {
            type: 'object',
            properties: {
                file: { type: 'string' },
            },
            required: ['file'],
        },
        permissions: [PERMISSIONS.accessLintingAnalysis],
        handler: handleGetFileLintProblems,
        validator: [validateDirectoryAccess],
        promptGenerator: (actionData: ActionData) => `get linting diagnostics for "${actionData.params.file}".`,
    },
    get_folder_lint_problems: {
        name: 'get_folder_lint_problems',
        description: 'Gets linting diagnostics for a folder.',
        schema: {
            type: 'object',
            properties: {
                folder: { type: 'string' },
            },
            required: ['folder'],
        },
        permissions: [PERMISSIONS.accessLintingAnalysis],
        handler: handleGetFolderLintProblems,
        validator: [validateDirectoryAccess],
        promptGenerator: (actionData: ActionData) => `get linting diagnostics for "${actionData.params.folder}".`,
    },
    get_workspace_lint_problems: {
        name: 'get_workspace_lint_problems',
        description: 'Gets linting diagnostics for the current workspace.',
        permissions: [PERMISSIONS.accessLintingAnalysis],
        handler: handleGetWorkspaceLintProblems,
        validator: [() => {
            const workspace = getWorkspacePath();
            if (!workspace) {
                return actionValidationFailure('Unable to get current workspace.');
            }
            validatePath(workspace, 'workspace');
            return actionValidationAccept();
        }],
        promptGenerator: () => 'get linting diagnostics for the current workspace.',
    },
} satisfies Record<string, RCEAction>;

export function registerLintActions() {
    if (getPermissionLevel(PERMISSIONS.accessLintingAnalysis)) {
        NEURO.client?.registerActions(stripToActions([
            lintActions.get_file_lint_problems,
            lintActions.get_folder_lint_problems,
            lintActions.get_workspace_lint_problems,
        ]));
    }
}

// Helper: Formats raw diagnostics (from the API) into readable lines.
interface RawLintProblem {
    severity: string;
    message: string;
    range: [{ line: number; character: number }, { line: number; character: number }];
    source?: string;
    code?: string;
}

function formatLintProblems(problems: RawLintProblem[], filePath: string): string[] {
    return problems.map(p => {
        const severity = p.severity;
        const msg = p.message;
        const codeVal = p.code || '';
        const start = p.range[0] || { line: 0, character: 0 };
        const line = start.line + 1;
        const col = start.character + 1;
        return `- [${filePath}] ${severity}: ${msg}${codeVal ? ` (${codeVal})` : ''} [Ln ${line}, Col ${col}]`;
    });
}

/**
 * Helper that accepts a file path and the raw diagnostics (from the API)
 * and returns a formatted string similar to the Visual Studio Code UI.
 */
export function getFormattedDiagnosticsForFile(filePath: string, diagnostics: vscode.Diagnostic[]): string {
    // Convert raw diagnostics into our RawLintProblem format.
    const problems: RawLintProblem[] = diagnostics.map(diag => ({
        severity: typeof diag.severity === 'string'
            ? diag.severity
            : vscode.DiagnosticSeverity[diag.severity],
        message: diag.message,
        range: [
            { line: diag.range.start.line, character: diag.range.start.character },
            { line: diag.range.end.line, character: diag.range.end.character },
        ],
        source: diag.source,
        code: diag.code !== undefined
            ? typeof diag.code === 'object'
                ? diag.code.value.toString()
                : diag.code.toString()
            : undefined,
    }));
    const formattedLines = formatLintProblems(problems, filePath);
    return '\n' + formattedLines.join('\n');
}


// Handle diagnostics for a single file
export function handleGetFileLintProblems(actionData: ActionData): string | undefined {
    const relativePath = actionData.params.file;
    const workspacePath = getWorkspacePath();
    assert(workspacePath);

    try {
        const normalizedPath = normalizePath(workspacePath + '/' + relativePath);

        const rawDiagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(normalizedPath));
        if (rawDiagnostics.length === 0) {
            return `No linting problems found for file ${relativePath}.`;
        }

        const formattedDiagnostics = getFormattedDiagnosticsForFile(relativePath, rawDiagnostics);
        NEURO.client?.sendContext(`Linting problems for file ${relativePath}:${formattedDiagnostics}`);
        return;
    } catch (erm) {
        logOutput('ERROR', `Getting diagnostics for ${relativePath} failed: ${erm}`);
        return contextFailure(`Failed to get linting diagnostics for "${relativePath}".`);
    }
}

export function handleGetFolderLintProblems(actionData: ActionData): string | undefined {
    const relativeFolder = actionData?.params.folder;

    const workspacePath = getWorkspacePath();
    assert(workspacePath);

    try {
        const normalizedFolderPath = normalizePath(workspacePath + '/' + relativeFolder);

        const diagnostics = vscode.languages.getDiagnostics();

        // Filter diagnostics to those that belong to files in this folder.
        const folderDiagnostics = diagnostics.filter(([diagUri, diags]) => {
            return normalizePath(diagUri.fsPath).startsWith(normalizedFolderPath) &&
                isPathNeuroSafe(diagUri.fsPath) && diags.length > 0;
        });

        if (folderDiagnostics.length === 0) {
            NEURO.client?.sendContext(`No linting problems found for folder "${relativeFolder}".`);
            return;
        }

        const formattedDiagnostics = folderDiagnostics.map(([uri, diags]) => {
            const relative = vscode.workspace.asRelativePath(uri.fsPath);
            return getFormattedDiagnosticsForFile(relative, diags);
        }).join('\n');

        NEURO.client?.sendContext(`Linting problems for folder "${relativeFolder}":\n${formattedDiagnostics}`);
        return;
    } catch (erm) {
        logOutput('ERROR', `Getting diagnostics for folder ${relativeFolder} failed: ${erm}`);
        return contextFailure(`Failed to get linting diagnostics for folder "${relativeFolder}".`);
    }
}

// Handle diagnostics for the entire workspace
export function handleGetWorkspaceLintProblems(_actionData: ActionData): string | undefined {
    const workspacePath = getWorkspacePath();
    if (!workspacePath) {
        return contextFailure('No workspace opened.');
    }

    try {
        const diagnostics = vscode.languages.getDiagnostics();
        // Filter for diagnostics on safe files with errors.
        const safeDiagnostics = diagnostics.filter(
            ([uri, diags]) => isPathNeuroSafe(uri.fsPath) && diags.length > 0,
        );

        if (safeDiagnostics.length === 0) {
            return contextFailure('No linting problems found for the current workspace.');
        }

        const formattedDiagnostics = safeDiagnostics.map(([uri, diags]) => {
            const relative = vscode.workspace.asRelativePath(uri.fsPath);
            return getFormattedDiagnosticsForFile(relative, diags);
        }).join('\n\n');

        return `Linting problems for the current workspace:\n${formattedDiagnostics}`;
    } catch (erm) {
        logOutput('ERROR', `Failed to get diagnostics for workspace: ${erm}`);
        return contextFailure("Couldn't get diagnostics for the workspace.");
    }
}

/**
 * Function that computes the diagnostic diff (new diagnostics compared to the previous state)
 * for only the URIs provided in the event change and sends only the new diagnostic entries to Neuro.
 * It respects the extension setting in CONFIG.sendNewLintingProblemsOn, which can be:
 *   - "off": Do nothing.
 *   - "inCurrentFile": Only send diff if the active file changed.
 *   - "inWorkspace": Send diff for any change in the workspace.
 */
export function sendDiagnosticsDiff(e: vscode.DiagnosticChangeEvent): void {
    // Check the extension setting.
    const setting = CONFIG.sendNewLintingProblemsOn;
    if (setting === 'off') {
        return;
    }

    const workspacePath = getWorkspacePath();
    if (!workspacePath) {
        logOutput('ERROR', 'Workspace folder not found.');
        return;
    }

    // Convert the read-only array to a mutable one.
    let changedUris: vscode.Uri[] = Array.from(e.uris);
    if (setting === 'inCurrentFile') {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }
        const activeFilePath = activeEditor.document.uri.fsPath;
        changedUris = Array.from(e.uris).filter(uri => uri.fsPath === activeFilePath);
        if (changedUris.length === 0) {
            return;
        }
    }

    const previousDiagnosticsMap = NEURO.previousDiagnosticsMap;
    const addedDiagnostics = new Map<string, vscode.Diagnostic[]>();

    // For each changed URI in the event...
    changedUris.forEach(uri => {
        if (!isPathNeuroSafe(uri.fsPath)) {
            return;
        }
        const currentDiags = vscode.languages.getDiagnostics(uri);
        const oldDiags = previousDiagnosticsMap.get(uri.fsPath) || [];
        const diff = currentDiags.filter(newDiag =>
            !oldDiags.some(oldDiag =>
                oldDiag.message === newDiag.message &&
                newDiag.range.isEqual(oldDiag.range) &&
                oldDiag.severity === newDiag.severity,
            ),
        );
        if (diff.length > 0) {
            addedDiagnostics.set(uri.fsPath, diff);
        }
        previousDiagnosticsMap.set(uri.fsPath, currentDiags);
    });

    if (addedDiagnostics.size === 0) {
        return;
    }

    const output = Array.from(addedDiagnostics.entries())
        .map(([filePath, diags]) => {
            const relative = vscode.workspace.asRelativePath(workspacePath + filePath);
            return getFormattedDiagnosticsForFile(relative, diags);
        })
        .join('\n\n');

    NEURO.client?.sendContext(`New linting problems:\n${output}`, false);
}

export async function fixWithNeuro(document?: vscode.TextDocument, diagnostics?: vscode.Diagnostic | vscode.Diagnostic[]): Promise<void> {
    if (document && diagnostics) {
        if (!Array.isArray(diagnostics))
            diagnostics = [diagnostics];
    } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }
        document = editor.document;
        diagnostics = vscode.languages.getDiagnostics(document.uri);
    }
    if (!diagnostics || diagnostics.length === 0) {
        vscode.window.showInformationMessage('No diagnostics found in the active file.');
        return;
    }

    vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@${NEURO.currentController !== 'Evil' && NEURO.currentController !== 'Neuro' ? 'neuroapi' : NEURO.currentController.toLowerCase()} /fix ${diagnostics.map(d => d.message).join('\n')}`,
    });
}

export async function explainWithNeuro(document?: vscode.TextDocument, diagnostics?: vscode.Diagnostic | vscode.Diagnostic[]): Promise<void> { // TODO: Typing
    if (document && diagnostics) {
        if (!Array.isArray(diagnostics))
            diagnostics = [diagnostics];
    } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }
        document = editor.document;
        diagnostics = vscode.languages.getDiagnostics(document.uri);
    }
    if (!diagnostics || diagnostics.length === 0) {
        vscode.window.showInformationMessage('No diagnostics found in the active file.');
        return;
    }

    vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@${NEURO.currentController !== 'Evil' && NEURO.currentController !== 'Neuro' ? 'neuroapi' : NEURO.currentController.toLowerCase()} /explain ${diagnostics.map(d => d.message).join('\n')}`,
    });
}

export class NeuroCodeActionsProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
    ];

    public provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        const actions: vscode.CodeAction[] = [];

        const fix = new vscode.CodeAction(
            `Ask ${NEURO.currentController} to fix`,
            vscode.CodeActionKind.QuickFix,
        );
        fix.command = {
            command: 'neuropilot.fixWithNeuro',
            title: `Ask ${NEURO.currentController} to fix`,
            arguments: [document, context.diagnostics],
        };
        fix.diagnostics = context.diagnostics.map(d => d);
        actions.push(fix);

        const explain = new vscode.CodeAction(
            `Ask ${NEURO.currentController} to explain`,
            vscode.CodeActionKind.QuickFix,
        );

        explain.command = {
            command: 'neuropilot.explainWithNeuro',
            title: `Ask ${NEURO.currentController} to explain`,
            arguments: [document, context.diagnostics],
        };

        explain.diagnostics = context.diagnostics.map(d => d);
        actions.push(explain);

        return actions;
    }
}
