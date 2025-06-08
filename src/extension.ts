import * as vscode from 'vscode';

import { NEURO } from './constants';
import { logOutput, createClient, onClientConnected, isPathNeuroSafe, setVirtualCursor } from './utils';
import { completionsProvider, registerCompletionResultHandler } from './completions';
import { giveCookie, registerRequestCookieAction, registerRequestCookieHandler, sendCurrentFile } from './context';
import { registerChatParticipant, registerChatResponseHandler } from './chat';
import { registerUnsupervisedActions, registerUnsupervisedHandlers } from './unsupervised';
import { reloadTasks, taskEndedHandler } from './tasks';
import { emergencyTerminalShutdown, saveContextForTerminal } from './pseudoterminal';
import { CONFIG } from './config';
import { explainWithNeuro, fixWithNeuro, NeuroCodeActionsProvider, sendDiagnosticsDiff } from './lint_problems';
import { editorChangeHandler, fileSaveListener, moveNeuroCursorHere, toggleSaveAction, workspaceEditHandler } from './editing';
import { emergencyDenyRequests, acceptRceRequest, denyRceRequest, revealRceNotification } from './rce';

export function activate(context: vscode.ExtensionContext) {
    NEURO.url = CONFIG.websocketUrl;
    NEURO.gameName = CONFIG.gameName;
    NEURO.connected = false;
    NEURO.waiting = false;
    NEURO.cancelled = false;
    NEURO.outputChannel = vscode.window.createOutputChannel('NeuroPilot');

    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, completionsProvider);

    vscode.commands.registerCommand('neuropilot.reconnect', reconnect);
    vscode.commands.registerCommand('neuropilot.moveNeuroCursorHere', moveNeuroCursorHere);
    vscode.commands.registerCommand('neuropilot.sendCurrentFile', sendCurrentFile);
    vscode.commands.registerCommand('neuropilot.giveCookie', giveCookie);
    vscode.commands.registerCommand('neuropilot.reloadPermissions', reloadPermissions);
    vscode.commands.registerCommand('neuropilot.disableAllPermissions', disableAllPermissions);
    vscode.commands.registerCommand('neuropilot.acceptRceRequest', acceptRceRequest);
    vscode.commands.registerCommand('neuropilot.denyRceRequest', denyRceRequest);
    vscode.commands.registerCommand('neuropilot.revealRceNotification', revealRceNotification);
    vscode.commands.registerCommand('neuropilot.fixWithNeuro', fixWithNeuro);
    vscode.commands.registerCommand('neuropilot.explainWithNeuro', explainWithNeuro);
    vscode.commands.registerCommand('neuropilot.switchNeuroAPIUser', switchCurrentNeuroAPIUser);
    vscode.commands.registerCommand('neuropilot.showDocsHomepage', () => {
        const panel = vscode.window.createWebviewPanel(
            'docsWebView',
            'NeuroPilot Docs (WebView)',
            vscode.ViewColumn.One,
            { enableScripts: true },
        );
        // Pass the homepage subpage ("/") to openDocsPage
        panel.webview.html = openDocsPage('/');
    });

    vscode.commands.registerCommand('neuropilot.openSpecificDocsPage', async (args?: { subpage?: string }) => {
        let subpage: string | undefined;
        if (args && typeof args.subpage === 'string') {
            subpage = args.subpage;
        } else {
            subpage = await vscode.window.showInputBox({
                prompt: 'Enter the docs subpath (e.g., /guide, /api, etc.)',
                placeHolder: '/',
            });
        }
        if (!subpage) {
            vscode.window.showErrorMessage('No subpage specified.');
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'docsWebView',
            'NeuroPilot Docs (WebView)',
            vscode.ViewColumn.One,
            { enableScripts: true },
        );
        panel.webview.html = openDocsPage(subpage);
    });

    // Update the CodeActionProvider to pass the document and diagnostics.
    vscode.languages.registerCodeActionsProvider(
        { scheme: 'file' },
        new NeuroCodeActionsProvider(),
        { providedCodeActionKinds: NeuroCodeActionsProvider.providedCodeActionKinds },
    );

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
    NEURO.currentController = CONFIG.currentlyAsNeuroAPI;
    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('neuropilot.currentlyAsNeuroAPI')) {
            NEURO.currentController = CONFIG.currentlyAsNeuroAPI;
            logOutput('DEBUG', `Changed current controller name to ${NEURO.currentController}.`);
        }
    });

    // Create status bar item
    NEURO.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(NEURO.statusBarItem);
    NEURO.statusBarItem.name = 'NeuroPilot';
    NEURO.statusBarItem.command = 'neuropilot.revealRceNotification';
    NEURO.statusBarItem.text = '$(neuropilot-heart)';
    NEURO.statusBarItem.tooltip = new vscode.MarkdownString('No active request');
    NEURO.statusBarItem.color = new vscode.ThemeColor('statusBarItem.foreground');
    NEURO.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.background');

    // sync the status bar item visibility with the setting
    if (CONFIG.hideCopilotRequests)
        NEURO.statusBarItem.show();

    // Set virtual cursor position for new files
    vscode.window.onDidChangeActiveTextEditor(editorChangeHandler);

    // Create cursor decoration type
    NEURO.cursorDecorationType = vscode.window.createTextEditorDecorationType(getDecorationRenderOptions(context));

    vscode.workspace.onDidChangeTextDocument(workspaceEditHandler);

    // Set virtual cursor for the initial file on startup
    if (vscode.window.activeTextEditor && isPathNeuroSafe(vscode.window.activeTextEditor.document.fileName))
        setVirtualCursor(vscode.window.activeTextEditor.selection.active);

    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('neuropilot.hideCopilotRequests')) {
            if (CONFIG.hideCopilotRequests) {
                NEURO.statusBarItem?.show();
            } else {
                NEURO.statusBarItem?.hide();
            }
        }
        if (
            event.affectsConfiguration('neuropilot.allowUnsafePaths')
            || event.affectsConfiguration('neuropilot.includePattern')
            || event.affectsConfiguration('neuropilot.excludePattern')
            || event.affectsConfiguration('neuropilot.permission.editActiveDocument')
        ) {
            setVirtualCursor();
        }
    });
}

function reconnect() {
    logOutput('INFO', 'Attempting to reconnect to Neuro API');
    createClient();
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
        if (NEURO.actionHandled) return;

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

function getDecorationRenderOptions(context: vscode.ExtensionContext) {
    return {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        border: '1px solid rgba(0, 0, 0, 0)',
        borderRadius: '1px',
        overviewRulerColor: 'rgba(255, 85, 229, 0.5)',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        gutterIconPath: context.asAbsolutePath('icon.png'),
        gutterIconSize: 'contain',
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        before: {
            contentText: 'ᛙ',
            margin: '0 0 0 -0.25ch',
            textDecoration: 'none; position: absolute; display: inline-block; top: 0; font-size: 200%; font-weight: bold, z-index: 1',
            color: 'rgba(255, 85, 229)',
        },
    };
}

function switchCurrentNeuroAPIUser() {
    const quickPick = vscode.window.createQuickPick();
    quickPick.items = [
        { label: 'Neuro' },
        { label: 'Evil' },
        { label: 'Randy' },
        { label: 'Jippity' },
        { label: 'Tony' },
        { label: 'Gary' },
    ];
    quickPick.placeholder = 'Switch to who?';
    quickPick.activeItems = quickPick.items.filter(item => item.label === NEURO.currentController);
    quickPick.onDidAccept(() => {
        const selected = quickPick.activeItems[0].label ?? quickPick.value;
        if (!selected) {
            logOutput('ERROR', 'No selection was made.');
            quickPick.hide();
            return;
        }
        vscode.workspace.getConfiguration('neuropilot').update('currentlyAsNeuroAPI', selected, vscode.ConfigurationTarget.Workspace);
        quickPick.hide();
    });
    quickPick.show();
}

function openDocsPage(subpage = '/'): string {
    const baseDocsPage = 'https://pasu4.github.io/neuropilot';
    let constructedDocsPage = baseDocsPage;
    if (subpage.startsWith('/')) {
        constructedDocsPage += subpage;
    } else {
        constructedDocsPage += '/' + subpage;
    }

    const htmlpage =
    '<!DOCTYPE html>' +
    '<html lang="en">' +
    '<head>' +
    '   <meta charset="UTF-8">' +
    `   <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${constructedDocsPage}; script-src 'none'; style-src 'unsafe-inline';">` + // Content Security Policy for safety reasons
    '   <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '   <title>NeuroPilot Docs WebView</title>' +
    '   <style>' +
    '       html, body, iframe {' +
    '           width: 100%;' +
    '           height: 100%;' +
    '           margin: 0;' +
    '           padding: 0;' +
    '           border: none;' +
    '       }' +
    '   </style>' +
    '</head>' +
    '<body>' +
    `   <iframe src="${constructedDocsPage}" frameborder="0"></iframe>` +
    '</body>' +
    '</html>';

    return htmlpage;
}
