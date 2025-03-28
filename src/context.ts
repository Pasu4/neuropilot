import * as vscode from 'vscode';

import { logOutput, simpleFileName } from "./utils";
import { NEURO } from './constants';

export function sendCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if(!editor) {
        logOutput('ERROR', 'No active text editor');
        vscode.window.showErrorMessage('No active text editor.');
        return;
    }
    const document = editor.document;
    const fileName = simpleFileName(document.fileName);
    const language = document.languageId;
    const text = document.getText();

    if(!NEURO.connected) {
        logOutput('ERROR', 'Attempted to send current file while disconnected');
        vscode.window.showErrorMessage('Not connected to Neuro API.');
        return;
    }

    logOutput('INFO', 'Sending current file to Neuro API');
    NEURO.client?.sendContext(`Current file: ${fileName}\n\nContent:\n\n\`\`\`${language}\n${text}\n\`\`\``);
}

export function registerRequestCookieAction() {
    NEURO.client?.unregisterActions(['request_cookie']);

    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.requestCookies', true))
        return;
    
    NEURO.client?.registerActions([
        {
            name: 'request_cookie',
            description: 'Ask Vedal for a cookie.',
        }
    ]);
}

export function registerRequestCookieHandler() {
    NEURO.client?.onAction((actionData) => {
        if(actionData.name === 'request_cookie') {
            if(!vscode.workspace.getConfiguration('neuropilot').get('permission.requestCookies', true)) {
                logOutput('WARNING', 'Neuro attempted to request a cookie, but permission is disabled');
                NEURO.client?.sendActionResult(actionData.id, true, 'Permission to request cookies is disabled.');
            }
            if(NEURO.waitingForCookie) {
                logOutput('INFO', 'Already waiting for a cookie');
                NEURO.client?.sendActionResult(actionData.id, true, 'You already asked for a cookie.');
                return;
            }
            NEURO.waitingForCookie = true;
            NEURO.client?.sendActionResult(actionData.id, true, 'Vedal has been asked for a cookie.');

            vscode.window.showInformationMessage('Neuro is asking for a cookie.', 'Give', 'Deny').then((value) => {
                if(value === 'Give') {
                    giveCookie();
                } else if(value === 'Deny') {
                    denyCookie();
                }
                NEURO.waitingForCookie = false;
            });
        }
    });
}

export function giveCookie() {
    NEURO.waitingForCookie = false;
    if(!NEURO.connected) {
        logOutput('ERROR', 'Attempted to give cookie while disconnected');
        vscode.window.showErrorMessage('Not connected to Neuro API.');
        return;
    }

    logOutput('INFO', 'Giving cookie to Neuro');
    NEURO.client?.sendContext('Vedal gave you a cookie!');
}

export function denyCookie() {
    NEURO.waitingForCookie = false;
    if(!NEURO.connected) {
        logOutput('ERROR', 'Attempted to deny cookie while disconnected');
        vscode.window.showErrorMessage('Not connected to Neuro API.');
        return;
    }

    logOutput('INFO', 'Denying cookie to Neuro');
    NEURO.client?.sendContext('Vedal denied you the cookie.');
}
