import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NEURO } from './constants';
import { normalizePath, getWorkspacePath, logOutput, isPathNeuroSafe } from './utils';
import { PERMISSIONS, getPermissionLevel, CONFIG } from './config';
import { ActionData, actionValidationAccept, actionValidationFailure, ActionValidationResult, ActionWithHandler, contextFailure } from './neuro_client_helper';
import assert from 'assert';

function validatePath(path: string, directoryType: string): ActionValidationResult | void {
    if (!isPathNeuroSafe(getWorkspacePath() + '/' + normalizePath(path).replace(/^\/|\/$/g, ''))) {
        return actionValidationFailure(`You are not allowed to access this ${directoryType}.`);
    }
};

function validateDirectoryAccess(actionData: ActionData): ActionValidationResult {
    const workspacePath = getWorkspacePath();
    if (!workspacePath) {
        return actionValidationFailure('Unable to get current workspace.');
    }

    if (actionData.params?.file) {
        const relativePath = actionData.params.file;
        const normalizedPath = normalizePath(path.join(workspacePath, relativePath));
        const check = validatePath(normalizedPath, 'file');
        if (!check.success) return check;
        if (!fs.existsSync(normalizedPath)) {
            return actionValidationFailure(`File "${relativePath}" does not exist.`);
        }
    }
    if (actionData.params?.folder) {
        const relativePath = actionData.params.folder;
        const normalizedPath = normalizePath(path.join(workspacePath, relativePath));
        const check = validatePath(normalizedPath, 'folder');
        if (!check.success) return check;
        if (!fs.existsSync(normalizedPath)) {
            return actionValidationFailure(`Folder "${relativePath}" does not exist.`);
        }
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
} satisfies Record<string, ActionWithHandler>;

export function registerLintActions() {
    if (getPermissionLevel(PERMISSIONS.accessLintingAnalysis)) {
        NEURO.client?.registerActions([
            lintActions.get_file_lint_problems,
            lintActions.get_folder_lint_problems,
            lintActions.get_workspace_lint_problems,
        ]);
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
        const absolutePath = path.join(workspacePath, relativePath);
        const normalizedPath = normalizePath(absolutePath);

        const rawDiagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(normalizedPath));
        if (rawDiagnostics.length === 0) {
            return `No linting problems found for file ${relativePath}.`;
        }
        const formattedDiagnostics = getFormattedDiagnosticsForFile(relativePath, rawDiagnostics); // use relativePath
        return `Linting problems for file ${relativePath}:${formattedDiagnostics}`;
    } catch (erm) {
        logOutput('ERROR', `Getting diagnostics for ${relativePath} failed: ${erm}`);
        return contextFailure(`Failed to get linting diagnostics for "${relativePath}".`);
    }
}

// Handle diagnostics for a folder
export function handleGetFolderLintProblems(actionData: ActionData): string | undefined {
    const relativeFolder = actionData?.params.folder;

    const workspacePath = getWorkspacePath();
    assert(workspacePath);

    try {
        const absoluteFolderPath = path.join(workspacePath, relativeFolder);
        const normalizedFolderPath = normalizePath(absoluteFolderPath);

        const diagnostics = vscode.languages.getDiagnostics();
        const folderDiagnostics = diagnostics.filter(([uri, diags]) => {
            return normalizePath(uri.fsPath).startsWith(normalizedFolderPath) && isPathNeuroSafe(uri.fsPath) && diags.length > 0;
        });

        if (folderDiagnostics.length === 0) {
            return 'No linting problems found.';
        }

        const formattedDiagnostics = folderDiagnostics.map(([uri, diags]) => {
            const relative = path.relative(workspacePath, uri.fsPath);
            return getFormattedDiagnosticsForFile(relative, diags);
        }).join('\n');

        return `Linting problems for folder ${relativeFolder}: ${formattedDiagnostics}`;
    } catch (erm) {
        logOutput('ERROR', `Getting diagnostics for folder ${relativeFolder} failed: ${erm}`);
        return contextFailure(`Failed to get linting diagnostics for folder "${relativeFolder}".`);
    }
}

// Handle diagnostics for the entire workspace
export function handleGetWorkspaceLintProblems(_actionData: ActionData): string | undefined {
    const workspacePath = getWorkspacePath();
    assert(workspacePath);

    try {
        const diagnostics = vscode.languages.getDiagnostics();
        const safeDiagnostics = diagnostics.filter(([uri, diags]) => isPathNeuroSafe(uri.fsPath) && diags.length > 0);

        if (safeDiagnostics.length === 0) {
            return 'No linting problems found.';
        }

        const formattedDiagnostics = safeDiagnostics.map(([uri, diags]) => {
            const relative = path.relative(workspacePath, uri.fsPath);
            return getFormattedDiagnosticsForFile(relative, diags);
        }).join('\n\n');

        return `Linting problems for the current workspace: ${formattedDiagnostics}`;
    } catch (erm) {
        logOutput('ERROR', `Failed to get diagnostics for workspace. Error: ${erm}`);
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
            const relative = path.relative(workspacePath, filePath);
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
        query: `@neuro /fix ${diagnostics.map(d => d.message).join('\n')}`,
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
        query: `@neuro /explain ${diagnostics.map(d => d.message).join('\n')}`,
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
            'Ask Neuro to fix',
            vscode.CodeActionKind.QuickFix,
        );
        fix.command = {
            command: 'neuropilot.fixWithNeuro',
            title: 'Ask Neuro to fix',
            arguments: [document, context.diagnostics],
        };
        fix.diagnostics = context.diagnostics.map(d => d);
        actions.push(fix);

        const explain = new vscode.CodeAction(
            'Ask Neuro to explain',
            vscode.CodeActionKind.QuickFix,
        );

        explain.command = {
            command: 'neuropilot.explainWithNeuro',
            title: 'Ask Neuro to explain',
            arguments: [document, context.diagnostics],
        };

        explain.diagnostics = context.diagnostics.map(d => d);
        actions.push(explain);

        return actions;
    }
}
