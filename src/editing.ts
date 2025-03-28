import * as vscode from 'vscode';

import { NEURO } from "./constants";
import { getPositionContext, isPathNeuroSafe, logOutput } from './utils';


export function handlePlaceCursor(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.editActiveDocument', false)) {
        logOutput('WARNING', 'Neuro attempted to place the cursor, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have edit permissions.');
        return;
    }

    const line = actionData.params?.line;
    const character = actionData.params?.character;

    if(line === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "line"');
        return;
    }
    if(character === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "character"');
        return;
    }

    const document = vscode.window.activeTextEditor?.document;
    if(document === undefined) {
        NEURO.client?.sendActionResult(actionData.id, true, 'No active document to place the cursor in');
        return;
    }
    if(!isPathNeuroSafe(document.fileName)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to access this file');
        return;
    }
    if(line >= document.lineCount) {
        NEURO.client?.sendActionResult(actionData.id, false, `Line is out of bounds, the last line of the document is ${document.lineCount - 1}`);
        return;
    }
    if(character >= document.lineAt(line).text.length) {
        NEURO.client?.sendActionResult(actionData.id, false, `Character is out of bounds, the last character of the line is ${document.lineAt(line).text.length - 1}`);
        return;
    }

    vscode.window.activeTextEditor!.selection = new vscode.Selection(line, character, line, character);
    const cursorContext = getPositionContext(document, new vscode.Position(line, character));
    logOutput('INFO', `Placed cursor at line ${line}, character ${character}`);
    NEURO.client?.sendActionResult(actionData.id, true, `Cursor placed at line ${line}, character ${character}\n\nContext before:\n\n\`\`\`\n${cursorContext.contextBefore}\n\`\`\`\n\nContext after:\n\n\`\`\`\n${cursorContext.contextAfter}\n\`\`\``);
}

export function handleGetCursor(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.editActiveDocument', false)) {
        logOutput('WARNING', 'Neuro attempted to get the cursor position, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have edit permissions.');
        return;
    }

    const document = vscode.window.activeTextEditor?.document;
    if(document === undefined) {
        NEURO.client?.sendActionResult(actionData.id, true, 'No active document to get the cursor position from');
        return;
    }
    if(!isPathNeuroSafe(document.fileName)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to access this file');
        return;
    }
    
    const cursorContext = getPositionContext(document, vscode.window.activeTextEditor!.selection.active);
    const line = vscode.window.activeTextEditor!.selection.active.line;
    const character = vscode.window.activeTextEditor!.selection.active.character;
    const relativePath = vscode.workspace.asRelativePath(document.uri);
    logOutput('INFO', `Sending cursor position to Neuro`);
    NEURO.client?.sendActionResult(actionData.id, true, `In file ${relativePath}\n\nCursor is at line ${line}, character ${character}\n\nContext before:\n\n\`\`\`\n${cursorContext.contextBefore}\n\`\`\`\n\nContext after:\n\n\`\`\`\n${cursorContext.contextAfter}\n\`\`\``);
}

export function handleInsertText(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.editActiveDocument', false)) {
        logOutput('WARNING', 'Neuro attempted to insert text, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have edit permissions.');
        return;
    }

    const text = actionData.params?.text;
    if(text === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "text"');
        return;
    }

    const document = vscode.window.activeTextEditor?.document;
    if(document === undefined) {
        NEURO.client?.sendActionResult(actionData.id, true, 'No active document to insert text into');
        return;
    }
    if(!isPathNeuroSafe(document.fileName)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to access this file');
        return;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, vscode.window.activeTextEditor!.selection.active, text);

    NEURO.client?.sendActionResult(actionData.id, true);
    vscode.workspace.applyEdit(edit).then(success => {
        if(success) {
            logOutput('INFO', `Inserting text into document`);
        }
        else {
            logOutput('ERROR', 'Failed to apply text insertion edit');
            NEURO.client?.sendContext('Failed to insert text');
        }
    });
}

export function handleReplaceText(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.editActiveDocument', false)) {
        logOutput('WARNING', 'Neuro attempted to replace text, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have edit permissions.');
        return;
    }

    const oldText = actionData.params?.oldText;
    const newText = actionData.params?.newText;
    if(oldText === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "oldText"');
        return;
    }
    if(newText === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "newText"');
        return;
    }

    const document = vscode.window.activeTextEditor?.document;
    if(document === undefined) {
        NEURO.client?.sendActionResult(actionData.id, true, 'No active document to replace text in');
        return;
    }
    if(!isPathNeuroSafe(document.fileName)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to access this file');
        return;
    }

    const oldStart = document.getText().indexOf(oldText);
    if(oldStart === -1) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Old text not found in document');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(oldStart), document.positionAt(oldStart + oldText.length)), newText);
    vscode.workspace.applyEdit(edit).then(success => {
        if(success) {
            logOutput('INFO', `Replacing text in document`);
            vscode.window.activeTextEditor!.selection = new vscode.Selection(document.positionAt(oldStart + newText.length), document.positionAt(oldStart + newText.length));
        }
        else {
            logOutput('ERROR', 'Failed to apply text replacement edit');
            NEURO.client?.sendContext('Failed to replace text');
        }
    });
}

export function handleDeleteText(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.editActiveDocument', false)) {
        logOutput('WARNING', 'Neuro attempted to delete text, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have edit permissions.');
        return;
    }

    const document = vscode.window.activeTextEditor?.document;
    if(document === undefined) {
        NEURO.client?.sendActionResult(actionData.id, true, 'No active document to delete text from');
        return;
    }
    if(!isPathNeuroSafe(document.fileName)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to access this file');
        return;
    }

    const textToDelete = actionData.params?.textToDelete;
    if(textToDelete === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "textToDelete"');
        return;
    }

    const textStart = document.getText().indexOf(textToDelete);
    if(textStart === -1) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Text to delete not found in document');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true);

    const edit = new vscode.WorkspaceEdit();
    edit.delete(document.uri, new vscode.Range(document.positionAt(textStart), document.positionAt(textStart + textToDelete.length)));
    vscode.workspace.applyEdit(edit).then(success => {
        if(success) {
            logOutput('INFO', `Deleting text from document`);
            vscode.window.activeTextEditor!.selection = new vscode.Selection(document.positionAt(textStart), document.positionAt(textStart));
        }
        else {
            logOutput('ERROR', 'Failed to apply text deletion edit');
            NEURO.client?.sendContext('Failed to delete text');
        }
    });
}

export function handlePlaceCursorAtText(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.editActiveDocument', false)) {
        logOutput('WARNING', 'Neuro attempted to place the cursor at text, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have edit permissions.');
        return;
    }

    const text = actionData.params?.text;
    const position = actionData.params?.position;
    if(text === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "text"');
        return;
    }
    if(position === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "position"');
        return;
    }
    if(position !== 'before' && position !== 'after') {
        NEURO.client?.sendActionResult(actionData.id, false, 'Invalid value for parameter "position" (must be one of ["before", "after"])');
        return;
    }

    const document = vscode.window.activeTextEditor?.document;
    if(document === undefined) {
        NEURO.client?.sendActionResult(actionData.id, true, 'No active document to place the cursor in');
        return;
    }
    if(!isPathNeuroSafe(document.fileName)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to access this file');
        return;
    }

    const textStart = document.getText().indexOf(text);
    if(textStart === -1) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Text not found in document');
        return;
    }

    let pos = position === 'before' ? textStart : textStart + text.length;
    const line = document.positionAt(pos).line;
    const character = document.positionAt(pos).character;

    vscode.window.activeTextEditor!.selection = new vscode.Selection(line, character, line, character);
    const cursorContext = getPositionContext(document, new vscode.Position(line, character));
    logOutput('INFO', `Placed cursor at text ${position} the first occurrence`);
    NEURO.client?.sendActionResult(actionData.id, true, `Cursor placed at text ${position} the first occurrence (line ${line}, character ${character})\n\nContext before:\n\n\`\`\`\n${cursorContext.contextBefore}\n\`\`\`\n\nContext after:\n\n\`\`\`\n${cursorContext.contextAfter}\n\`\`\``);
}
