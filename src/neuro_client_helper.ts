/**
 * Helper functions and types for interacting with the Neuro Game SDK.
 */

import { Action } from 'neuro-game-sdk';
import { Permission, PermissionLevel } from './config';
import { logOutput } from './utils';
import { PromptGenerator } from './rce';

/** Data used by an action handler. */
export interface ActionData {
    id: string;
    name: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: any;
}

/** The result of attempting to execute an action client-side. */
export interface ActionValidationResult {
    /**
     * If `false`, the action handler is not executed.
     * Warning: This is *not* the success parameter of the action result.
     */
    success: boolean;
    /**
     * The message to send Neuro.
     * If success is `true`, this is optional, otherwise it should be an error message.
     */
    message?: string;
    /** If `true`, Neuro should retry the action if it was forced. */
    retry?: boolean;
}

/** ActionHandler to use with constants for records of actions and their corresponding handlers */
export interface RCEAction extends Action {
    /** The permissions required to execute this action. */
    permissions: Permission[];
    /** The function to validate the action data *after* checking the schema. */
    validator?: (((actionData: ActionData) => ActionValidationResult) | ((actionData: ActionData) => Promise<ActionValidationResult>))[];
    /** The function to handle the action. */
    handler: (actionData: ActionData) => string | undefined;
    /** 
     * The function to generate a prompt for the action request (Copilot Mode). 
     * The prompt should fit the phrasing scheme "Neuro wants to [prompt]".
     * It is this way due to a potential new addition in Neuro API "v2". (not officially proposed)
     * More info (comment): https://github.com/VedalAI/neuro-game-sdk/discussions/58#discussioncomment-12938623
     */
    promptGenerator: PromptGenerator;
    /** Default permission for actions like chat, cancel_request, etc */
    defaultPermission?: PermissionLevel;
}

/**
 * Strips an action to the form expected by the API.
 * @param action The action to strip to its basic form.
 * @returns The action stripped to its basic form, without the handler and permissions.
 */
export function stripToAction(action: RCEAction): Action {
    return {
        name: action.name,
        description: action.description,
        schema: action.schema,
    };
}

/**
 * Strips an array of actions to the form expected by the API.
 * (Calls {@link stripToAction} for each action in the array.)
 * @param actions The actions to strip to their basic form.
 * @returns An array of actions stripped to their basic form, without the handler and permissions.
 */
export function stripToActions(actions: RCEAction[]): Action[] {
    return actions.map(stripToAction);
}

/**
 * Create a successful action result.
 * This should be used if all parameters have been parsed correctly.
 * @param message An optional message to send to Neuro.
 * @returns A successful action result.
 */
export function actionValidationAccept(message?: string): ActionValidationResult {
    return {
        success: true,
        retry: false,
        message: message,
    };
}

/**
 * Create an action result with the specified message.
 * This should be used if the action failed, but should not be retried, e.g.
 * if the source of the error is out of Neuro's control or to prevent a retry
 * loop in case the action is not applicable in the current state.
 * @param message The message to send to Neuro.
 * This should explain, if possible, why the action failed.
 * If omitted, will just send "Action failed.".
 * @param {boolean} [retry=false] Whether to retry the action if it was forced. Defaults to `false`.
 * @returns A successful action result with the specified message.
 */
export function actionValidationFailure(message: string, retry = false): ActionValidationResult {
    logOutput('WARNING', 'Action failed: ' + message);
    return {
        success: false,
        retry: retry,
        message: message !== undefined ? `Action failed: ${message}` : 'Action failed.',
    };
}

/**
 * Create a context message that tells Neuro that the action failed and logs this.
 * Also logs the message to the console.
 * Note that this does not send the context message.
 * @param message The message to format.
 * @param {string} [tag="WARNING"] The tag to use for the log output.
 * This should explain, if possible, why the action failed.
 * If omitted, will just return "Action failed.".
 * @returns A context message with the specified message.
 */
export function contextFailure(message?: string, tag = 'WARNING'): string {
    const result = message !== undefined ? `Action failed: ${message}` : 'Action failed.';
    logOutput(tag, result);
    return result;
}

/**
 * Create an action result that tells Neuro to retry the forced action.
 * @param message The message to send to Neuro.
 * This should contain the information required to fix the mistake.
 * @returns A failed action result with the specified message.
 */
export function actionValidationRetry(message: string): ActionValidationResult {
    logOutput('WARNING', 'Action failed: ' + message + '\nRequesting retry.');
    return {
        success: false,
        retry: true,
        message: 'Action failed: ' + message,
    };
}

/**
 * Create an action result that tells Neuro that a required parameter is missing.
 * @param parameterName The name of the missing parameter.
 * @returns An failed action result with a message pointing out the missing parameter.
 * @deprecated Handled by the schema validator.
 */
export function actionResultMissingParameter(parameterName: string): ActionValidationResult {
    logOutput('WARNING', `Action failed: Missing required parameter "${parameterName}"`);
    return {
        success: false,
        message: `Action failed: Missing required parameter "${parameterName}"`,
    };
}

/**
 * @deprecated Handled by the schema validator.
 */
export function actionResultIncorrectType(parameterName: string, expectedType: string, actualType: string): ActionValidationResult {
    logOutput('WARNING', `Action failed: "${parameterName}" must be of type "${expectedType}", but got "${actualType}".`);
    return {
        success: false,
        message: `Action failed: "${parameterName}" must be of type "${expectedType}", but got "${actualType}".`,
    };
}

/**
 * Create an action result that tells Neuro that she doesn't have the required permission.
 * @param permission The permission Neuro doesn't have.
 * @returns A successful action result with a message pointing out the missing permission.
 * @deprecated Handled by the permissions checker component of RCE.
 */
export function actionValidationNoPermission(permission: Permission): ActionValidationResult {
    logOutput('WARNING', `Action failed: Neuro attempted to ${permission.infinitive}, but permission is disabled.`);
    return {
        success: true,
        message: `Action failed: You do not have permission to ${permission.infinitive}.`,
    };
}

/**
 * Create a context message that tells Neuro that she doesn't have permission to access a path.
 * Note that this does not send the context message.
 * @param path The path that was attempted to be accessed.
 * @returns A context message pointing out the missing permission.
 */
export function contextNoAccess(path: string): string {
    logOutput('WARNING', `Action failed: Neuro attempted to access "${path}", but permission is disabled.`);
    return 'Action failed: You do not have permission to access the requested location(s).';
}

/**
 * @deprecated Handled by the schema validator.
 */
export function actionResultEnumFailure<T>(parameterName: string, validValues: T[], value: T): ActionValidationResult {
    logOutput('WARNING', `Action failed: "${parameterName}" must be one of ${JSON.stringify(validValues)}, but got ${JSON.stringify(value)}.`);
    return {
        success: false,
        message: `Action failed: "${parameterName}" must be one of ${JSON.stringify(validValues)}, but got ${JSON.stringify(value)}.`,
    };
}
