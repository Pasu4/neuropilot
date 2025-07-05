/**
 * rce stands for Requested Command Execution
 * (or Request for Command Execution if you don't mind the omitted 'f')
 */

import * as vscode from 'vscode';
import { ActionData, RCEAction } from './neuro_client_helper';
import { NEURO } from './constants';
import { checkWorkspaceTrust, logOutput } from './utils';
import { CONFIG, getPermissionLevel, PermissionLevel, PERMISSIONS } from './config';
import { handleRunTask } from './tasks';
import { validate } from 'jsonschema';

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

/**
 * RCE action handler code for unsupervised requests.
 * Intended to be used with something like `NEURO.client?.onAction(async (actionData: ActionData) => await RCEActionHandler(actionData, actionList, true))
 * @param actionData The action data from Neuro.
 * @param actionList The list of actions currently registered.
 * @param checkTasks Whether or not to check for tasks.
 */
export async function RCEActionHandler(actionData: ActionData, actionList: Record<string, RCEAction>, checkTasks: boolean) {
    const actionKeys = Object.keys(actionList);
    if (actionKeys.includes(actionData.name) || checkTasks === true && NEURO.tasks.find(task => task.id === actionData.name)) {
        NEURO.actionHandled = true;

        let action: RCEAction;
        if (actionKeys.includes(actionData.name)) {
            action = actionList[actionData.name];
        }
        else {
            const task = NEURO.tasks.find(task => task.id === actionData.name)!;
            action = {
                name: task.id,
                description: task.description,
                permissions: [PERMISSIONS.runTasks],
                handler: handleRunTask,
                validator: [checkWorkspaceTrust],
                promptGenerator: () => `run the task "${task.id}".`,
            };
        }

        const effectivePermission = action.permissions.length > 0 ? getPermissionLevel(...action.permissions) : action.defaultPermission ?? PermissionLevel.COPILOT;
        if (effectivePermission === PermissionLevel.OFF) {
            const offPermission = action.permissions.find(permission => getPermissionLevel(permission) === PermissionLevel.OFF);
            NEURO.client?.sendActionResult(actionData.id, true, `Action failed: You don't have permission to ${offPermission?.infinitive ?? 'execute this action'}.`);
            return;
        }

        // Validate schema
        if (action.schema) {
            const schemaValidationResult = validate(actionData.params, action.schema, { required: true });
            if (!schemaValidationResult.valid) {
                const message = 'Action failed: ' + schemaValidationResult.errors[0]?.stack;
                NEURO.client?.sendActionResult(actionData.id, false, message);
                return;
            }
        }

        // Validate custom
        if (action.validator) {
            for (const validate of action.validator) {
                const actionResult = await validate(actionData);
                if (!actionResult.success) {
                    NEURO.client?.sendActionResult(actionData.id, !(actionResult.retry ?? false), actionResult.message);
                    return;
                }
            }
        }

        if (effectivePermission === PermissionLevel.AUTOPILOT) {
            const result = action.handler(actionData);
            NEURO.client?.sendActionResult(actionData.id, true, result);
        }
        else { // permissionLevel === PermissionLevel.COPILOT
            if (NEURO.rceRequest) {
                NEURO.client?.sendActionResult(actionData.id, true, 'Action failed: Already waiting for permission to run another action.');
                return;
            }

            // literally why can't we use " 'x wants to' + typeof action.promptGenerator === 'string' "
            const prompt = typeof action.promptGenerator === 'string'
                ? NEURO.currentController + ' wants to ' + (action.promptGenerator as string).trim()
                : NEURO.currentController + ' wants to ' + (action.promptGenerator as (actionData: ActionData) => string)(actionData).trim();

            createRceRequest(
                prompt,
                () => action.handler(actionData),
            );

            NEURO.statusBarItem!.tooltip = new vscode.MarkdownString(prompt);
            NEURO.client?.registerActions([cancelRequestAction]);
            NEURO.statusBarItem!.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            NEURO.statusBarItem!.color = new vscode.ThemeColor('statusBarItem.warningForeground');

            // Show the RCE dialog immediately if the config says so
            if (!CONFIG.hideCopilotRequests)
                revealRceNotification();

            // End of added code.
            NEURO.client?.sendActionResult(actionData.id, true, 'Requested permission to run action.');
        }
    }
}
