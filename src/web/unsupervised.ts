import { NEURO } from '../constants';
import { fileActions, registerFileActions } from '../file_actions';
import { editingActions, registerEditingActions } from '../editing';
import { ActionData, RCEAction } from '../neuro_client_helper';
import { lintActions, registerLintActions } from '../lint_problems';
import { cancelRequestAction, RCEActionHandler } from '../rce';

/**
 * Web portion
 */

/**
 * Register unsupervised actions with the Neuro API.
 * Will only register actions that the user has given permission to use.
 */

const neuroActions: Record<string, RCEAction> = {
    'cancel_request': cancelRequestAction,
    ...fileActions,
    ...editingActions,
    ...lintActions,
};

const actionKeys: string[] = Object.keys(neuroActions);

export function registerUnsupervisedActions() {
    // Unregister all actions first to properly refresh everything
    NEURO.client?.unregisterActions(actionKeys);

    registerFileActions();
    registerEditingActions();
    registerLintActions();
}

/**
 * Register unsupervised handlers for Neuro API actions.
 * The handlers will only handle actions that the user has given permission to use.
 */
export function registerUnsupervisedHandlers() {
    NEURO.client?.onAction(async (actionData: ActionData) => RCEActionHandler(actionData, neuroActions, false));
}
