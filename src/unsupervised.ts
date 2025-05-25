import * as vscode from 'vscode';
import { NEURO } from './constants';
import { handleRunTask, registerTaskActions, taskHandlers } from './tasks';
import { fileActions, registerFileActions } from './file_actions';
import { gitActions, registerGitActions } from './git';
import { editingActions, registerEditingActions } from './editing';
import { ActionData, ActionWithHandler } from './neuro_client_helper';
import { registerTerminalActions, terminalAccessHandlers } from './pseudoterminal';
import { lintActions, registerLintActions } from './lint_problems';
import { cancelRequestAction, createRceRequest, revealRceNotification } from './rce';
import { validate } from 'jsonschema';
import { CONFIG, getPermissionLevel, PermissionLevel, PERMISSIONS } from './config';

/**
 * Register unsupervised actions with the Neuro API.
 * Will only register actions that the user has given permission to use.
 */

const neuroActions: Record<string, ActionWithHandler> = {
    'cancel_request': cancelRequestAction,
    ...gitActions,
    ...fileActions,
    ...taskHandlers,
    ...editingActions,
    ...terminalAccessHandlers,
    ...lintActions,
};

const actionKeys: string[] = Object.keys(neuroActions);

export function registerUnsupervisedActions() {
    // Unregister all actions first to properly refresh everything
    NEURO.client?.unregisterActions(actionKeys);

    registerFileActions();
    registerGitActions();
    registerTaskActions();
    registerEditingActions();
    registerTerminalActions();
    registerLintActions();
}

/**
 * Register unsupervised handlers for Neuro API actions.
 * The handlers will only handle actions that the user has given permission to use.
 */
export function registerUnsupervisedHandlers() {
    NEURO.client?.onAction((actionData: ActionData) => {
        if (actionKeys.includes(actionData.name) || NEURO.tasks.find(task => task.id === actionData.name)) {
            NEURO.actionHandled = true;

            let action: ActionWithHandler;
            if (actionKeys.includes(actionData.name)) {
                action = neuroActions[actionData.name];
            }
            else {
                const task = NEURO.tasks.find(task => task.id === actionData.name)!;
                action = {
                    name: task.id,
                    description: task.description,
                    permissions: [PERMISSIONS.runTasks],
                    handler: handleRunTask,
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
                    const actionResult = validate(actionData);
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

                const prompt = typeof action.promptGenerator === 'string'
                    ? 'Neuro wants to ' + (action.promptGenerator as string).trim()
                    : 'Neuro wants to ' + (action.promptGenerator as (actionData: ActionData) => string)(actionData).trim();

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
    });
}
