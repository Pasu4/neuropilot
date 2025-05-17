/**
 * rce stands for Requested Command Execution
 * (or Request for Command Execution if you don't mind the omitted 'f')
 */

import * as vscode from 'vscode';
import { ActionData, ActionWithHandler } from './neuro_client_helper';
import { NEURO } from './constants';
import { logOutput } from './utils';
import { PermissionLevel } from './config';

/**
 * A prompt parameter can either be a string or a function that converts ActionData into a prompt string.
 */
export type PromptGenerator = string | ((actionData: ActionData) => string);

export const cancelRequestAction: ActionWithHandler = {
    name: 'cancel_request',
    description: 'Cancel the current request.',
    permissions: [],
    handler: handleCancelRequest,
    promptGenerator: () => '', // No prompt needed for this action
    defaultPermission: PermissionLevel.AUTOPILOT,
};

/**
 * Handles cancellation requests from Neuro.
 */
export function handleCancelRequest(_actionData: ActionData): string | undefined {
    if (!NEURO.rceCallback) {
        return 'No active request to cancel.';
    }
    clearRceDialog();
    return 'Request cancelled.';
}

/**
 * RCE's emergency shutdown component
 * Automatically clears the RCE dialog and tell Neuro her requests was cancelled.
 * Only runs if there is an RCE callback in NEURO.
 */
export function emergencyDenyRequests(): void {
    if (!NEURO.rceCallback) {
        return;
    }
    clearRceDialog();
    logOutput("INFO", `Cancelled ${NEURO.rceCallback} due to emergency shutdown.`)
    NEURO.client?.sendContext("Your last request was denied.")
    vscode.window.showInformationMessage("The last request from Neuro has been denied automatically.")
}

export function clearRceDialog(): void { // Function to clear out RCE dialogs
    NEURO.rceCallback = null;
    NEURO.client?.unregisterActions([cancelRequestAction.name]);
    NEURO.statusBarItem!.tooltip = 'No active request';
    NEURO.statusBarItem!.color = new vscode.ThemeColor('statusBarItem.foreground');
    NEURO.statusBarItem!.backgroundColor = new vscode.ThemeColor('statusBarItem.background');
}

export function openRceDialog(): void {
    if(!NEURO.rceCallback)
        return;

    const callback = NEURO.rceCallback;
    const message = typeof NEURO.statusBarItem!.tooltip === 'string'
        ? NEURO.statusBarItem!.tooltip
        : NEURO.statusBarItem!.tooltip!.value;
    vscode.window.showInformationMessage(message, 'Accept', 'Deny').then(
        (value) => {
            if(NEURO.rceCallback !== callback) // Multiple messages may be opened, ensure that callback is only called once
                return;
            clearRceDialog();
            if(value === 'Accept') {
                NEURO.client?.sendContext('Vedal has accepted your request.');
                const result = callback();
                if(result)
                    NEURO.client?.sendContext(result);
            } else {
                NEURO.client?.sendContext('Vedal has denied your request.');
            }
        },
    );
}

