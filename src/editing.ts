import * as vscode from 'vscode';

import { NEURO } from './constants';
import { escapeRegExp, getFence, getPositionContext, getVirtualCursor, isPathNeuroSafe, logOutput, NeuroPositionContext, setVirtualCursor, substituteMatch } from './utils';
import { ActionData, actionValidationAccept, actionValidationFailure, ActionValidationResult, RCEAction, contextFailure, stripToActions } from './neuro_client_helper';
import { PERMISSIONS, getPermissionLevel, CONFIG } from './config';

const CONTEXT_NO_ACCESS = 'You do not have permission to access this file.';
const CONTEXT_NO_ACTIVE_DOCUMENT = 'No active document to edit.';

const MATCH_OPTIONS: string[] = ['firstInFile', 'lastInFile', 'firstAfterCursor', 'lastBeforeCursor', 'allInFile'] as const;

function checkCurrentFile(_actionData: ActionData): ActionValidationResult {
    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined)
        return actionValidationFailure(CONTEXT_NO_ACTIVE_DOCUMENT);
    if (!isPathNeuroSafe(document.fileName))
        return actionValidationFailure(CONTEXT_NO_ACCESS);

    return actionValidationAccept();
}

export const editingActions = {
    place_cursor: {
        name: 'place_cursor',
        description: 'Place the cursor in the current file. Absolute line and column numbers are one-based.',
        schema: {
            type: 'object',
            properties: {
                line: { type: 'integer' },
                column: { type: 'integer' },
                type: { type: 'string', enum: ['relative', 'absolute'] },
            },
            required: ['line', 'column', 'type'],
        },
        permissions: [PERMISSIONS.editActiveDocument],
        handler: handlePlaceCursor,
        validator: [checkCurrentFile],
        promptGenerator: (actionData: ActionData) => `place the cursor at (${actionData.params.line}:${actionData.params.column}).`,
    },
    get_cursor: {
        name: 'get_cursor',
        description: 'Get the current cursor position and the text surrounding it',
        permissions: [PERMISSIONS.editActiveDocument],
        handler: handleGetCursor,
        validator: [checkCurrentFile],
        promptGenerator: 'get the current cursor position and the text surrounding it.',
    },
    insert_text: {
        name: 'insert_text',
        description: 'Insert code at the current cursor position',
        schema: {
            type: 'object',
            properties: {
                text: { type: 'string' },
            },
            required: ['text'],
        },
        permissions: [PERMISSIONS.editActiveDocument],
        handler: handleInsertText,
        validator: [checkCurrentFile],
        promptGenerator: (actionData: ActionData) => {
            const lineCount = actionData.params.text.trim().split('\n').length;
            return `insert ${lineCount} line${lineCount === 1 ? '' : 's'} of code.`;
        },
    },
    replace_text: {
        name: 'replace_text',
        description: 'Replace text in the active document. If you set "useRegex" to true, you can use a Regex in the "find" parameter and a subtitution pattern in the "replaceWith" parameter.',
        schema: {
            type: 'object',
            properties: {
                find: { type: 'string' },
                replaceWith: { type: 'string' },
                useRegex: { type: 'boolean' },
                match: { type: 'string', enum: MATCH_OPTIONS },
            },
            required: ['find', 'replaceWith', 'match'],
        },
        permissions: [PERMISSIONS.editActiveDocument],
        handler: handleReplaceText,
        validator: [checkCurrentFile],
        promptGenerator: (actionData: ActionData) => `replace "${actionData.params.useRegex ? escapeRegExp(actionData.params.find) : actionData.params.find}" with "${actionData.params.replaceWith}".`,
    },
    delete_text: {
        name: 'delete_text',
        description: 'Delete text in the active document. If you set "useRegex" to true, you can use a Regex in the "find" parameter.',
        schema: {
            type: 'object',
            properties: {
                find: { type: 'string' },
                useRegex: { type: 'boolean' },
                match: { type: 'string', enum: MATCH_OPTIONS },
            },
            required: ['find', 'match'],
        },
        permissions: [PERMISSIONS.editActiveDocument],
        handler: handleDeleteText,
        validator: [checkCurrentFile],
        promptGenerator: (actionData: ActionData) => `delete "${actionData.params.useRegex ? escapeRegExp(actionData.params.find) : actionData.params.find}".`,
    },
    find_text: {
        name: 'find_text',
        description: 'Find text in the active document. If you set "useRegex" to true, you can use a Regex in the "find" parameter.',
        schema: {
            type: 'object',
            properties: {
                find: { type: 'string' },
                useRegex: { type: 'boolean' },
                match: { type: 'string', enum: MATCH_OPTIONS },
            },
            required: ['find', 'match'],
        },
        permissions: [PERMISSIONS.editActiveDocument],
        handler: handleFindText,
        validator: [checkCurrentFile],
        promptGenerator: (actionData: ActionData) => `find "${actionData.params.useRegex ? escapeRegExp(actionData.params.find) : actionData.params.find}".`,
    },
    undo: {
        name: 'undo',
        description: 'Undo the last action in the active document. If this doesn\'t work, tell Vedal to focus your VS Code window.',
        permissions: [PERMISSIONS.editActiveDocument],
        handler: handleUndo,
        validator: [checkCurrentFile],
        promptGenerator: 'undo the last action.',
    },
    save: {
        name: 'save',
        description: 'Manually save the currently open document.',
        permissions: [PERMISSIONS.editActiveDocument],
        handler: handleSave,
        validator: [checkCurrentFile],
        promptGenerator: 'save.',
    },
} satisfies Record<string, RCEAction>;

export function registerEditingActions() {
    if (getPermissionLevel(PERMISSIONS.editActiveDocument)) {
        NEURO.client?.registerActions(stripToActions([
            editingActions.place_cursor,
            editingActions.get_cursor,
            editingActions.insert_text,
            editingActions.replace_text,
            editingActions.delete_text,
            editingActions.find_text,
            editingActions.undo,
        ]));
        if (vscode.workspace.getConfiguration('files').get<string>('autoSave') !== 'afterDelay') {
            NEURO.client?.registerActions(stripToActions([
                editingActions.save,
            ]));
        };
    }
}

export function toggleSaveAction(): void {
    const autoSave = vscode.workspace.getConfiguration('files').get<string>('autoSave');
    if (autoSave === 'afterDelay') {
        NEURO.client?.unregisterActions(['save']);
    } else {
        NEURO.client?.registerActions(stripToActions([editingActions.save]));
    }
}

export function handlePlaceCursor(actionData: ActionData): string | undefined {
    // One-based line and column (depending on config)
    let line = actionData.params.line;
    let column = actionData.params.column;
    const type = actionData.params.type;

    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined)
        return contextFailure(CONTEXT_NO_ACTIVE_DOCUMENT);
    if (!isPathNeuroSafe(document.fileName))
        return contextFailure(CONTEXT_NO_ACCESS);

    let basedLine: number, basedColumn: number;

    if (type === 'relative') {
        const cursor = getVirtualCursor()!;
        line += cursor.line;
        column += cursor.character;

        basedLine = line + 1;
        basedColumn = column + 1;
    }
    else {
        basedLine = line;
        basedColumn = column;

        line -= 1;
        column -= 1;
    }

    if (line >= document.lineCount || line < 0) {
        return contextFailure(`Line is out of bounds, the last line of the document is ${document.lineCount}.`);
    }
    if (column > document.lineAt(line).text.length || column < 0)
        return contextFailure(`Column is out of bounds, the last column of line ${basedLine} is ${document.lineAt(line).text.length + 1}.`);

    const cursorPosition = new vscode.Position(line, column);
    setVirtualCursor(cursorPosition);
    const cursorContext = getPositionContext(document, cursorPosition);
    logOutput('INFO', `Placed ${NEURO.currentController}'s virtual cursor at (${basedLine}:${basedColumn}).`);

    return `Cursor placed at (${basedLine}:${basedColumn})\n\n${formatContext(cursorContext)}`;
}

export function handleGetCursor(_actionData: ActionData): string | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined)
        return contextFailure(CONTEXT_NO_ACTIVE_DOCUMENT);
    if (!isPathNeuroSafe(document.fileName))
        return contextFailure(CONTEXT_NO_ACCESS);

    const cursorPosition = getVirtualCursor()!;
    const cursorContext = getPositionContext(document, cursorPosition);
    const relativePath = vscode.workspace.asRelativePath(document.uri);
    logOutput('INFO', `Sending cursor position to ${NEURO.currentController}`);

    return `In file ${relativePath}\n\nCursor is at (${cursorPosition.line + 1}:${cursorPosition.character + 1})\n\n${formatContext(cursorContext)}`;
}

export function handleInsertText(actionData: ActionData): string | undefined {
    const text: string = actionData.params.text;

    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined)
        return contextFailure(CONTEXT_NO_ACTIVE_DOCUMENT);
    if (!isPathNeuroSafe(document.fileName))
        return contextFailure(CONTEXT_NO_ACCESS);

    const insertStart = getVirtualCursor()!;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, insertStart, text);

    vscode.workspace.applyEdit(edit).then(success => {
        if (success) {
            logOutput('INFO', 'Inserting text into document');
            const document = vscode.window.activeTextEditor!.document;
            const insertEnd = document.positionAt(document.offsetAt(insertStart) + text.length);
            const cursorContext = getPositionContext(document, insertStart, insertEnd);
            NEURO.client?.sendContext(`Inserted text into document\n\n${formatContext(cursorContext)}`);
        }
        else {
            NEURO.client?.sendContext(contextFailure('Failed to insert text'));
        }
    });

    return undefined;
}

export function handleReplaceText(actionData: ActionData): string | undefined {
    const find: string = actionData.params.find;
    const replaceWith: string = actionData.params.replaceWith;
    const match: string = actionData.params.match;
    const useRegex = actionData.params.useRegex ?? false;

    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined)
        return contextFailure(CONTEXT_NO_ACTIVE_DOCUMENT);
    if (!isPathNeuroSafe(document.fileName))
        return contextFailure(CONTEXT_NO_ACCESS);

    const regex = new RegExp(useRegex ? find : escapeRegExp(find), 'g');
    const cursorOffset = document.offsetAt(getVirtualCursor()!);

    const matches = findAndFilter(regex, document.getText(), cursorOffset, match);
    if (matches.length === 0)
        return 'No matches found for the given parameters.';

    const edit = new vscode.WorkspaceEdit();
    for (const m of matches) {
        try {
            const replacement = useRegex ? substituteMatch(m, replaceWith) : replaceWith;
            edit.replace(document.uri, new vscode.Range(document.positionAt(m.index), document.positionAt(m.index + m[0].length)), replacement);
        } catch (erm) {
            logOutput('ERROR', `Error while substituting match: ${erm}`);
            return contextFailure(erm instanceof Error ? erm.message : 'Unknown error while substituting match');
        }
    }
    vscode.workspace.applyEdit(edit).then(success => {
        if (success) {
            logOutput('INFO', 'Replacing text in document');
            if (matches.length === 1) {
                // Single match
                const document = vscode.window.activeTextEditor!.document;
                const startPosition = document.positionAt(matches[0].index);
                const endPosition = document.positionAt(matches[0].index + substituteMatch(matches[0], replaceWith).length);
                setVirtualCursor(endPosition);
                const cursorContext = getPositionContext(document, startPosition, endPosition);
                NEURO.client?.sendContext(`Replaced text in document\n\n${formatContext(cursorContext)}`);
            }
            else {
                // Multiple matches
                const document = vscode.window.activeTextEditor!.document;
                const fence = getFence(document.getText());
                NEURO.client?.sendContext(`Deleted ${matches.length} occurrences from the document\n\nUpdated content:\n\n${fence}\n${document.getText()}\n${fence}`);
            }
        }
        else {
            NEURO.client?.sendContext(contextFailure('Failed to replace text'));
        }
    });
}

export function handleDeleteText(actionData: ActionData): string | undefined {
    const find = actionData.params.find;
    const match: string = actionData.params.match;
    const useRegex = actionData.params?.useRegex ?? false;

    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined)
        return contextFailure(CONTEXT_NO_ACTIVE_DOCUMENT);
    if (!isPathNeuroSafe(document.fileName))
        return contextFailure(CONTEXT_NO_ACCESS);

    const regex = new RegExp(useRegex ? find : escapeRegExp(find), 'g');
    const cursorOffset = document.offsetAt(getVirtualCursor()!);

    const matches = findAndFilter(regex, document.getText(), cursorOffset, match);
    if (matches.length === 0)
        return 'No matches found for the given parameters.';

    const edit = new vscode.WorkspaceEdit();
    for (const m of matches) {
        edit.delete(document.uri, new vscode.Range(document.positionAt(m.index), document.positionAt(m.index + m[0].length)));
    }
    vscode.workspace.applyEdit(edit).then(success => {
        if (success) {
            logOutput('INFO', 'Deleting text from document');
            if (matches.length === 1) {
                // Single match
                const document = vscode.window.activeTextEditor!.document;
                setVirtualCursor(document.positionAt(matches[0].index));
                const cursorContext = getPositionContext(document, document.positionAt(matches[0].index));
                NEURO.client?.sendContext(`Deleted text from document\n\n${formatContext(cursorContext)}`);
            }
            else {
                // Multiple matches
                const document = vscode.window.activeTextEditor!.document;
                const fence = getFence(document.getText());
                NEURO.client?.sendContext(`Deleted ${matches.length} occurrences from the document\n\nUpdated content:\n\n${fence}\n${document.getText()}\n${fence}`);
            }
        }
        else {
            NEURO.client?.sendContext(contextFailure('Failed to delete text'));
        }
    });
}

export function handleFindText(actionData: ActionData): string | undefined {
    const find = actionData.params.find;
    const match = actionData.params.match;
    const useRegex = actionData.params?.useRegex ?? false;

    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined)
        return contextFailure(CONTEXT_NO_ACTIVE_DOCUMENT);
    if (!isPathNeuroSafe(document.fileName))
        return contextFailure(CONTEXT_NO_ACCESS);

    const regex = new RegExp(useRegex ? find : escapeRegExp(find), 'g');
    const cursorOffset = document.offsetAt(getVirtualCursor()!);

    const matches = findAndFilter(regex, document.getText(), cursorOffset, match);
    if (matches.length === 0)
        return 'No matches found for the given parameters.';

    if (matches.length === 1) {
        // Single match
        const offset = matches[0].index;
        const pos = document.positionAt(offset);
        setVirtualCursor(pos);
        const cursorContext = getPositionContext(document, pos);
        logOutput('INFO', `Placed cursor at (${pos.line + 1}:${pos.character + 1})`);
        return `Found match and placed cursor at (${pos.line + 1}:${pos.character + 1})\n\n${formatContext(cursorContext)}`;
    }
    else {
        // Multiple matches
        const positions = matches.map(m => document.positionAt(m.index));
        const lines = positions.map(p => document.lineAt(p.line).text);
        // max(1, ...) because log10(0) is -Infinity
        const padding = Math.max(1, Math.log10(positions[positions.length - 1].line + 1) + 1); // Space for the line number
        logOutput('INFO', `Found ${positions.length} matches`);
        const text = lines.map((line, i) => `L. ${(positions[i].line + 1).toString().padStart(padding)}: ${line}`).join('\n');
        const fence = getFence(text);
        return `Found ${positions.length} matches:\n\n${fence}\n${text}\n${fence}`;
    }
}

export function handleUndo(_actionData: ActionData): string | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined)
        return contextFailure(CONTEXT_NO_ACTIVE_DOCUMENT);
    if (!isPathNeuroSafe(document.fileName))
        return contextFailure(CONTEXT_NO_ACCESS);

    vscode.commands.executeCommand('undo').then(
        () => {
            logOutput('INFO', 'Undoing last action in document');
            // We don't keep track of the cursor position in the undo stack, so we reset it to the real cursor position
            const cursorContext = getPositionContext(document, vscode.window.activeTextEditor!.selection.active);
            setVirtualCursor(vscode.window.activeTextEditor!.selection.active);
            NEURO.client?.sendContext(`Undid last action in document\n\n${formatContext(cursorContext)}`);
        },
        (erm) => {
            logOutput('ERROR', `Failed to undo last action: ${erm}`);
            NEURO.client?.sendContext(contextFailure('Failed to undo last action'));
        },
    );

    return undefined;
}

export function handleSave(_actionData: ActionData): string | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined)
        return contextFailure(CONTEXT_NO_ACTIVE_DOCUMENT);
    if (!isPathNeuroSafe(document.fileName))
        return contextFailure(CONTEXT_NO_ACCESS);

    NEURO.saving = true;
    logOutput('INFO', `${NEURO.currentController} is saving the current document.`);

    document.save().then(
        (saved) => {
            if (saved) {
                logOutput('INFO', 'Document saved successfully.');
                NEURO.client?.sendContext('Document saved successfully.', true);
            } else {
                logOutput('WARN', 'Document save returned false.');
                NEURO.client?.sendContext('Document did not save.', false);
            }
            NEURO.saving = false;
        },
        (erm: string) => {
            logOutput('ERROR', `Failed to save document: ${erm}`);
            NEURO.client?.sendContext(contextFailure('Failed to save document.'), false);
            NEURO.saving = false;
        },
    );

    return undefined;
}

export function fileSaveListener(e: vscode.TextDocument) {
    /**
     * In order from left to right, this function immediately returns if:
     * - NeuroPilot > Send Save Notifications is set to false
     * - the file that was saved isn't Neuro safe
     * - Neuro manually saved the file.
     */
    if (!CONFIG.sendSaveNotifications || !isPathNeuroSafe(e.fileName) || NEURO.saving === true) {
        return;
    }
    const relativePath = vscode.workspace.asRelativePath(e.uri);
    NEURO.client?.sendContext(`File ${relativePath} has been saved.`, true);
}

/**
 * Find matches in the text and filter based on the match option.
 * @param regex The regular expression to search for.
 * @param text The text to search in.
 * @param cursorOffset The current cursor offset in the text.
 * @param match The match option from the {@link MATCH_OPTIONS} array.
 * @returns The matches found in the text based on the match option.
 */
function findAndFilter(regex: RegExp, text: string, cursorOffset: number, match: string): RegExpExecArray[] {
    const matches = text.matchAll(regex);
    let result: RegExpExecArray[] = [];

    switch (match) {
        case 'firstInFile':
            for (const m of matches)
                return [m];
            return [];

        case 'lastInFile':
            for (const m of matches)
                result = [m];
            return result;

        case 'firstAfterCursor':
            for (const m of matches)
                if (m.index >= cursorOffset)
                    return [m];
            return [];

        case 'lastBeforeCursor':
            for (const m of matches)
                if (m.index < cursorOffset)
                    result = [m];
                else break;
            return result;

        case 'allInFile':
            for (const m of matches)
                result.push(m);
            return result;

        default:
            throw new Error(`Invalid match option: ${match}`);
    }
}

function formatContext(context: NeuroPositionContext): string {
    const fence = getFence(context.contextBefore + context.contextBetween + context.contextAfter);
    return `Context (lines ${context.startLine + 1}-${context.endLine + 1}, cursor position denoted by \`<<<|>>>\`):\n\n${fence}\n${context.contextBefore}${context.contextBetween}<<<|>>>${context.contextAfter}\n${fence}`;
}

/**
 * Sets and displays the virtual cursor position when the active text editor changes.
 * @param editor The active text editor.
 */
export function editorChangeHandler(editor: vscode.TextEditor | undefined) {
    if (editor) {
        const uri = editor.document.uri;
        if (!NEURO.cursorOffsets.has(uri)) {
            if (isPathNeuroSafe(uri.fsPath))
                setVirtualCursor(editor.selection.active);
            else
                setVirtualCursor(null);
        }
        else {
            setVirtualCursor();
        }
    }
}

/**
 * Moves the virtual cursor when the text document changes.
 * @param event The editing event.
 * @returns 
 */
export function workspaceEditHandler(event: vscode.TextDocumentChangeEvent) {
    if (event.contentChanges.length === 0) return;
    if (event.document !== vscode.window.activeTextEditor?.document) return;
    if (!getPermissionLevel(PERMISSIONS.editActiveDocument)) return;

    const initialCursorOffset = NEURO.cursorOffsets.get(event.document.uri);
    if (initialCursorOffset === undefined || initialCursorOffset === null) return;

    for (const change of event.contentChanges) {
        logOutput('DEBUG', `Change detected in document ${event.document.fileName}: ${JSON.stringify(change)}`);

        const cursorOffset = NEURO.cursorOffsets.get(event.document.uri)!;
        const startOffset = event.document.offsetAt(change.range.start);

        if (startOffset > cursorOffset)
            // Change is after the cursor, no need to update it
            continue;

        const endOffset = change.rangeOffset + change.rangeLength;

        if (endOffset > cursorOffset) {
            // Change includes the cursor, place it at the end of the change
            setVirtualCursor(event.document.positionAt(change.rangeOffset + change.text.length));
        }
        else {
            // Change is before the cursor, move it by the change length
            const delta = change.text.length - change.rangeLength;
            setVirtualCursor(event.document.positionAt(cursorOffset + delta));
        }
    }
}

export function moveNeuroCursorHere() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active text editor');
        return;
    }
    if (!isPathNeuroSafe(editor.document.fileName)) {
        vscode.window.showErrorMessage(NEURO.currentController + ' does not have permission to access this file');
        return;
    }
    setVirtualCursor(editor.selection.active);

    const cursorContext = getPositionContext(editor.document, editor.selection.active);

    NEURO.client?.sendContext(`Vedal moved your cursor.\n\n${formatContext(cursorContext)}`);
}
