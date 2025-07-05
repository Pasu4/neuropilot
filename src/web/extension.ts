import * as vscode from 'vscode';
import { createClient, isPathNeuroSafe, setVirtualCursor } from '../utils';
import { NEURO } from '../constants';
import {
    initializeCommonState,
    setupCommonProviders,
    registerCommonCommands,
    setupCommonEventHandlers,
    setupClientConnectedHandlers,
    createStatusBarItem,
    deactivate as commonDeactivate,
    registerDocsLink,
    obtainExtensionState,
    getDecorationRenderOptions,
} from '../shared/extension-common';

export { registerDocsLink };

export function activate(context: vscode.ExtensionContext) {
    // Initialize common state
    initializeCommonState();

    // Setup providers
    context.subscriptions.push(...setupCommonProviders());

    // Register commands
    context.subscriptions.push(...registerCommonCommands());

    // Setup event handlers
    context.subscriptions.push(...setupCommonEventHandlers());

    // Setup client connected handlers
    setupClientConnectedHandlers();

    // Create status bar item
    createStatusBarItem(context);

    // Extension state
    obtainExtensionState();

    // Create client
    createClient();

    // Create cursor decoration (web-specific)
    NEURO.cursorDecorationType = vscode.window.createTextEditorDecorationType(getDecorationRenderOptions(context));

    // Set initial virtual cursor
    if (vscode.window.activeTextEditor && isPathNeuroSafe(vscode.window.activeTextEditor.document.fileName)) {
        setVirtualCursor(vscode.window.activeTextEditor.selection.active);
    }
}

export function deactivate() {
    commonDeactivate();
}
