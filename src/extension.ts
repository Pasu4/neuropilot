import * as vscode from 'vscode';

import { NEURO } from './constants';
import { logOutput, createClient, onClientConnected } from './utils';
import { completionsProvider, registerCompletionResultHandler } from './completions';
import { giveCookie, registerRequestCookieAction, registerRequestCookieHandler, sendCurrentFile } from './context';
import { registerChatParticipant, registerChatResponseHandler } from './chat';
import { registerUnsupervisedActions, registerUnsupervisedHandlers } from './unsupervised';
import { reloadTasks, taskEndedHandler } from './tasks';
import { emergencyTerminalShutdown, saveContextForTerminal } from './pseudoterminal';
import { CONFIG } from './config';
import { sendDiagnosticsDiff } from './lint_problems';
import { fileSaveListener, toggleSaveAction } from './editing';
import { emergencyDenyRequests, openRceDialog } from './rce';

export function activate(context: vscode.ExtensionContext) {
    NEURO.url = CONFIG.websocketUrl;
    NEURO.gameName = CONFIG.gameName;
    NEURO.connected = false;
    NEURO.waiting = false;
    NEURO.cancelled = false;
    NEURO.outputChannel = vscode.window.createOutputChannel('NeuroPilot');

    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, completionsProvider);

    vscode.commands.registerCommand('neuropilot.reconnect', async (..._args) => {
        logOutput('INFO', 'Attempting to reconnect to Neuro API');
        createClient();
    });
    vscode.commands.registerCommand('neuropilot.sendCurrentFile', sendCurrentFile);
    vscode.commands.registerCommand('neuropilot.giveCookie', giveCookie);
    vscode.commands.registerCommand('neuropilot.reloadPermissions', reloadPermissions);
    vscode.commands.registerCommand('neuropilot.disableAllPermissions', disableAllPermissions);
    vscode.commands.registerCommand('neuropilot.openRceDialog', openRceDialog);

    registerChatParticipant(context);
    saveContextForTerminal(context);

    onClientConnected(registerPreActionHandler);
    onClientConnected(registerCompletionResultHandler);
    onClientConnected(registerChatResponseHandler);
    onClientConnected(registerRequestCookieAction);
    onClientConnected(registerRequestCookieHandler);
    onClientConnected(reloadTasks);
    onClientConnected(registerUnsupervisedActions);
    onClientConnected(registerUnsupervisedHandlers);
    onClientConnected(registerPostActionHandler);

    vscode.languages.onDidChangeDiagnostics(sendDiagnosticsDiff);

    vscode.tasks.onDidEndTask(taskEndedHandler);

    vscode.workspace.onDidSaveTextDocument(fileSaveListener);

    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('files.autoSave')) {
            NEURO.client?.sendContext('The Auto-Save setting has been modified.');
            toggleSaveAction();
        }
    });

    createClient();

    NEURO.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(NEURO.statusBarItem);
    NEURO.statusBarItem.name = 'NeuroPilot';
    NEURO.statusBarItem.command = 'neuropilot.openRceDialog';
    NEURO.statusBarItem.text = '$(neuropilot-logo)';
    NEURO.statusBarItem.tooltip = new vscode.MarkdownString('No active request');
    NEURO.statusBarItem.color = new vscode.ThemeColor('statusBarItem.foreground');
    NEURO.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.background');
    NEURO.statusBarItem.show();
}

function reloadPermissions() {
    reloadTasks();
    registerRequestCookieAction();
    registerUnsupervisedActions();
}

function registerPreActionHandler() {
    NEURO.client?.onAction((_actionData) => {
        NEURO.actionHandled = false;
    });
}

function registerPostActionHandler() {
    NEURO.client?.onAction((actionData) => {
        if(NEURO.actionHandled) return;

        NEURO.client?.sendActionResult(actionData.id, true, 'Unknown action');
    });
}

function disableAllPermissions() {
    const config = vscode.workspace.getConfiguration('neuropilot');
    const permissionKeys = config.get<Record<string, string>>('permission');
    // Disable each permission one-by-one
    const promises: Thenable<void>[] = [];
    if (permissionKeys) {
        for (const key of Object.keys(permissionKeys)) {
            promises.push(config.update(`permission.${key}`, 'off', vscode.ConfigurationTarget.Workspace));
        }
    }
    if (CONFIG.allowUnsafePaths === true) {
        promises.push(config.update('allowUnsafePaths', false, vscode.ConfigurationTarget.Workspace));
    }
    if (CONFIG.sendNewLintingProblemsOn !== 'off') {
        promises.push(config.update('sendNewLintingProblemsOn', 'off', vscode.ConfigurationTarget.Workspace));
    }
    Promise.all(promises).then(() => {
        const exe = NEURO.currentTaskExecution;
        if (exe) {
            exe.terminate();
            NEURO.currentTaskExecution = null;
        }
        emergencyTerminalShutdown();
        emergencyDenyRequests();
        // Send context and reload
        reloadPermissions();
        NEURO.client?.sendContext('Vedal has turned off all dangerous permissions.');
        vscode.window.showInformationMessage('All dangerous permissions have been turned off and actions have been re-registered. Terminal shells have also been killed, if any.');
    });
}
