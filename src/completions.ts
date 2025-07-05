import { NeuroClient } from 'neuro-game-sdk';
import * as vscode from 'vscode';
import { NEURO } from './constants';
import { logOutput, simpleFileName, getPositionContext } from './utils';
import assert from 'node:assert';
import { CONFIG } from './config';

let lastSuggestions: string[] = [];

export function requestCompletion(beforeContext: string, afterContext: string, fileName: string, language: string, maxCount: number) {
    // If completions are disabled, notify and return early.
    if (CONFIG.completionTrigger === 'off') {
        if (!NEURO.warnOnCompletionsOff) {
            return;
        }
        vscode.window.showInformationMessage('Inline completions with NeuroPilot are disabled.', 'Don\'t show again this session')
            .then(selection => {
                if (selection === 'Don\'t show again this session') {
                    NEURO.warnOnCompletionsOff = false;
                }
            });
        return;
    }

    // Obviously we need Neuro to be connected
    if (!NEURO.connected) {
        logOutput('ERROR', 'Attempted to request completion while disconnected');
        vscode.window.showErrorMessage('Not connected to Neuro API.');
        return;
    }

    // You can't request a completion while already waiting
    if (NEURO.waiting) {
        logOutput('WARNING', 'Attempted to request completion while waiting for response');
        return;
    }

    logOutput('INFO', `Requesting completion for ${fileName}`);

    NEURO.waiting = true;
    NEURO.cancelled = false;

    assert(NEURO.client);

    NEURO.client.registerActions([
        {
            name: 'complete_code',
            description: maxCount == 1
                ? 'Suggest code to write.' +
                ' You may make one suggestion.' +
                ' Your suggestion can be a single line or a multi-line code snippet.'

                : 'Suggest code to write.' +
                ` You may make up to ${maxCount} suggestions, but only one will be used.` +
                ' Your suggestions can be single lines or multi-line code snippets.',
            schema: {
                type: 'object',
                properties: {
                    suggestions: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: maxCount,
                    },
                },
                required: ['suggestions'],
            },
        },
    ]);

    NEURO.client.forceActions(
        'Write code that fits between afterContext and beforeContext',
        ['complete_code'],
        JSON.stringify({
            file: fileName,
            language: language,
            beforeContext: beforeContext,
            afterContext: afterContext,
        }),
        false,
    );
}

export function cancelCompletionRequest() {
    NEURO.cancelled = true;
    NEURO.waiting = false;
    if (!NEURO.client) return;
    NEURO.client.unregisterActions(['complete_code']);
}

export function registerCompletionResultHandler() {
    NEURO.client?.onAction((actionData) => {
        assert(NEURO.client instanceof NeuroClient);

        if (actionData.name === 'complete_code') {
            NEURO.actionHandled = true;

            const suggestions = actionData.params?.suggestions;

            if (suggestions === undefined) {
                NEURO.client.sendActionResult(actionData.id, false, 'Missing required parameter "suggestions"');
                return;
            }

            NEURO.client.unregisterActions(['complete_code']);

            if (NEURO.cancelled) {
                NEURO.client.sendActionResult(actionData.id, true, 'Request was cancelled');
                NEURO.waiting = false;
                return;
            }
            if (!NEURO.waiting) {
                NEURO.client.sendActionResult(actionData.id, true, 'Not currently waiting for suggestions');
                return;
            }

            NEURO.waiting = false;

            NEURO.client.sendActionResult(actionData.id, true);

            lastSuggestions = suggestions;
            logOutput('INFO', 'Received suggestions:\n' + JSON.stringify(suggestions));
        }
    });
};

export const completionsProvider: vscode.InlineCompletionItemProvider = {
    async provideInlineCompletionItems(document, position, context, token) {
        const result: vscode.InlineCompletionList = {
            items: [],
        };

        const triggerAuto = CONFIG.completionTrigger === 'automatic';
        if (!triggerAuto && context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke) {
            return result;
        }

        // Get context
        const cursorContext = getPositionContext(document, position);
        const fileName = simpleFileName(document.fileName);
        const maxCount = CONFIG.maxCompletions || 3;

        requestCompletion(cursorContext.contextBefore, cursorContext.contextAfter, fileName, document.languageId, maxCount);

        token.onCancellationRequested(() => {
            logOutput('INFO', 'Cancelled request');
            cancelCompletionRequest();
        });

        const timeoutMs = CONFIG.timeout || 10000;
        const timeout = new Promise<void>((_, reject) => setTimeout(() => reject('Request timed out'), timeoutMs));
        const completion = new Promise<void>((resolve) => {
            const interval = setInterval(() => {
                if (!NEURO.waiting) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
        });

        try {
            await Promise.race([timeout, completion]);
        } catch (erm) {
            if (typeof erm === 'string') {
                logOutput('ERROR', erm);
                NEURO.cancelled = true;
                vscode.window.showErrorMessage(erm);
            }
            else {
                throw erm;
            }
        }

        for (const suggestion of lastSuggestions) {
            result.items.push({
                insertText: suggestion.trim(),
            });
        }

        return result;
    },
};
