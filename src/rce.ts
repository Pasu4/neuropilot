/**
 * rce stands for Requested Command Execution
 * (or Request for Command Execution if you don't mind the omitted 'f')
 */

import * as vscode from 'vscode';
import { ActionData, RCEAction } from './neuro_client_helper';
import { NEURO } from './constants';
import { logOutput } from './utils';
import { CONFIG, PermissionLevel } from './config';

/**
 * A prompt parameter can either be a string or a function that converts ActionData into a prompt string.
 */
export type PromptGenerator = string | ((actionData: ActionData) => string);

/**
 * RCE request object
 */
export interface RceRequest {
    /**
     * The prompt that describes the request.
     */
    prompt: string;
    /**
     * The callback function to be executed when the request is accepted.
     */
    callback: () => string | undefined;
    /**
     * Resolve the request, closing all attached notifications and clearing timers.
     */
    resolve: () => void;
    /**
     * Attach a `window.showProgress` notification to the request, allowing it to be dismissed on request resolution.
     * @param progress The progress object from `window.withProgress` to report the prompt and time passed to.
     * @returns A promise that resolves when the request is resolved.
     */
    attachNotification: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<void>;
    /**
     * Whether the notification has been revealed already.
     */
    notificationVisible: boolean;
}

export const cancelRequestAction: RCEAction = {
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
    if (!NEURO.rceRequest) {
        return 'No active request to cancel.';
    }
    clearRceRequest();
    return 'Request cancelled.';
}

/**
 * RCE's emergency shutdown component
 * Automatically clears the RCE dialog and tell Neuro her requests was cancelled.
 * Only runs if there is an RCE callback in NEURO.
 */
export function emergencyDenyRequests(): void {
    if (!NEURO.rceRequest) {
        return;
    }
    clearRceRequest();
    logOutput('INFO', `Cancelled ${NEURO.rceRequest.callback} due to emergency shutdown.`);
    NEURO.client?.sendContext('Your last request was denied.');
    vscode.window.showInformationMessage(`The last request from ${NEURO.currentController} has been denied automatically.`);
}

export function clearRceRequest(): void { // Function to clear out RCE dialogs
    NEURO.rceRequest?.resolve();
    NEURO.rceRequest = null;
    NEURO.client?.unregisterActions([cancelRequestAction.name]);
    NEURO.statusBarItem!.tooltip = 'No active request';
    NEURO.statusBarItem!.color = new vscode.ThemeColor('statusBarItem.foreground');
    NEURO.statusBarItem!.backgroundColor = new vscode.ThemeColor('statusBarItem.background');
}

/**
 * Creates a new RCE request and attaches it to NEURO.
 * @param prompt The prompt to be displayed in the notification.
 * @param callback The callback function to be executed when the request is accepted.
 */
export function createRceRequest(
    prompt: string,
    callback: () => string | undefined,
): void {
    NEURO.rceRequest = {
        prompt,
        callback,
        notificationVisible: false,

        // these immediately get replaced synchronously, this is just so we don't have them be nullable in the type
        resolve: () => { },
        attachNotification: async () => { },
    };

    const promise = new Promise<void>((resolve) => {
        // we can't add any buttons to progress, so we have to add the accept link
        const message = `${NEURO.rceRequest!.prompt} [Accept](command:neuropilot.acceptRceRequest)`;

        // this is null initially but will be assigned when a notification gets spawned
        let progress: vscode.Progress<{ message?: string; increment?: number }> | null = null;

        const progressStep = 100; // step progress bar every 100ms, looks completely smooth

        const timeoutDuration = CONFIG.requestExpiryTimeout;
        const hasTimeout = timeoutDuration && timeoutDuration > 0;
        // if there's no timeout we "don't pass" the increment, this makes the progress bar infinite
        const increment = hasTimeout ? progressStep / timeoutDuration * 100 : undefined;

        // keep track of the incremented value to correctly report progress when the notification gets attached
        let incremented = increment;

        let interval: NodeJS.Timeout | null = null;
        let timeout: NodeJS.Timeout | null = null;
        if (hasTimeout) {
            // if there's a timeout, we need to report progress
            interval = setInterval(() => {
                progress?.report({ message, increment });
                if (incremented)
                    incremented += increment!;
            }, progressStep);

            // actually handle the timeout
            timeout = setTimeout(() => {
                clearRceRequest();
                NEURO.client?.sendContext('Request expired.');
            }, timeoutDuration);
        }

        // this will be called on request resolution
        NEURO.rceRequest!.resolve = () => {
            if (interval)
                clearInterval(interval);
            if (timeout)
                clearTimeout(timeout);

            resolve();
        };

        NEURO.rceRequest!.attachNotification = async (p) => {
            // set internal progress to the one from the notification
            progress = p;
            // we need to set the prompt and report time passed if there's a timeout
            progress.report({ message, increment: incremented });

            // return this exact promise we're in so the notification closes on request resolution
            return promise;
        };
    });
}

/**
 * Reveals the RCE notification for the current request if it is not already visible.
 */
export function revealRceNotification(): void {
    if (!NEURO.rceRequest)
        return;

    // don't show the notification if it's already open
    if (NEURO.rceRequest.notificationVisible)
        return;

    NEURO.rceRequest.notificationVisible = true;

    // weirdly enough, a "notification" isn't actually a thing in vscode.
    // it's either a message, or in this case, progress report that takes shape of a notification
    // this is a workaround to show a notification that can be dismissed programmatically
    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            cancellable: true,
        },
        (progress, cancellationToken) => {
            // handle manual cancellation
            cancellationToken.onCancellationRequested(() => {
                denyRceRequest();
            });

            return NEURO.rceRequest!.attachNotification(progress);
        },
    );
}

/**
 * Accepts the current RCE request and executes the callback function.
 * If there is no request to accept, an error message is shown to the user.
 */
export function acceptRceRequest(): void {
    if (!NEURO.rceRequest) {
        vscode.window.showErrorMessage(`No active request from ${NEURO.currentController} to accept.`);
        return;
    }

    NEURO.client?.sendContext('Vedal has accepted your request.');

    const result = NEURO.rceRequest.callback();
    if (result)
        NEURO.client?.sendContext(result);

    clearRceRequest();
}

/**
 * Denies the current RCE request and clears the request object.
 * If there is no request to deny, an error message is shown to the user.
 */
export function denyRceRequest(): void {
    if (!NEURO.rceRequest) {
        vscode.window.showErrorMessage(`No active request from ${NEURO.currentController} to deny.`);
        return;
    }

    NEURO.client?.sendContext('Vedal has denied your request.');

    clearRceRequest();
}
