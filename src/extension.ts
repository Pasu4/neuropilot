import * as vscode from 'vscode';

import { NEURO } from './constants';
import { logOutput, createClient, onClientConnected } from './utils';
import { completionsProvider, registerCompletionResultHandler } from './completions';
import { giveCookie, registerRequestCookieAction, registerRequestCookieHandler, sendCurrentFile } from './context';
import { registerChatParticipant, registerChatResponseHandler } from './chat';
import { registerUnsupervisedActions, registerUnsupervisedHandlers } from './unsupervised';
import { reloadTasks, taskEndedHandler } from './tasks';

export function activate(context: vscode.ExtensionContext) {
    NEURO.url = vscode.workspace.getConfiguration('neuropilot').get('websocketUrl', 'http://localhost:8000');
    NEURO.gameName = vscode.workspace.getConfiguration('neuropilot').get('gameName', 'Visual Studio Code');
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

    registerChatParticipant(context);

    onClientConnected(registerCompletionResultHandler);
    onClientConnected(registerChatResponseHandler);
    onClientConnected(registerRequestCookieAction);
    onClientConnected(registerRequestCookieHandler);
    onClientConnected(reloadTasks);
    onClientConnected(registerUnsupervisedActions);
    onClientConnected(registerUnsupervisedHandlers);

    vscode.tasks.onDidEndTask(taskEndedHandler);

    createClient();
}

function reloadPermissions() {
    reloadTasks();
    registerRequestCookieAction();
    registerUnsupervisedActions();
}
