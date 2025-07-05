import * as vscode from 'vscode';

import { NEURO } from './constants';
import { filterFileContents, logOutput, simpleFileName } from './utils';
import { CONFIG } from './config';
import assert from 'node:assert';

interface Participant {
    id: string;
    relativeIconPath: string;
}

const NEURO_PARTICIPANTS: Participant[] = [
    {
        id: 'neuropilot.neuro',
        relativeIconPath: 'assets/neuropilot.png',
    },
    {
        id: 'neuropilot.evil',
        relativeIconPath: 'assets/evilpilot.png',
    },
    {
        id: 'neuropilot.api',
        relativeIconPath: 'assets/heart.png',
    },
];

interface NeuroChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    }
}

interface NeuroChatContext {
    fileName?: string;
    range?: vscode.Range;
    text: string;
}

let lastChatResponse = '';

export function registerChatResponseHandler() {
    NEURO.client?.onAction((actionData) => {
        if(actionData.name === 'chat') {
            NEURO.actionHandled = true;

            const answer = actionData.params?.answer;
            if(answer === undefined) {
                NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "answer"');
                return;
            }

            NEURO.client?.unregisterActions(['chat']);

            if(NEURO.cancelled) {
                NEURO.client?.sendActionResult(actionData.id, true, 'Request was cancelled');
                NEURO.waiting = false;
                return;
            }
            if(!NEURO.waiting) {
                NEURO.client?.sendActionResult(actionData.id, true, 'Not currently waiting for a chat response');
                return;
            }

            NEURO.waiting = false;

            NEURO.client?.sendActionResult(actionData.id, true);
            lastChatResponse = answer;
            NEURO.waiting = false;
            logOutput('INFO', 'Received chat response:\n' + answer);
        }
    });
}

export function registerChatParticipant(context: vscode.ExtensionContext) {
    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<NeuroChatResult> => {
        let prefix = '';
        const currentAPI = CONFIG.currentlyAsNeuroAPI;

        if(request.command === 'fix') {
            prefix = 'Vedal wants you to fix the following error(s):\n';
        }
        else if(request.command === 'explain') {
            prefix = 'Vedal wants you to explain the following:\n';
        }

        if(!NEURO.connected) {
            stream.markdown('Not connected to Neuro API.');
            stream.button({
                command: 'neuropilot.reconnect',
                title: 'Reconnect',
                tooltip: 'Attempt to reconnect to Neuro API',
            });
            return { metadata: { command: '' } };
        }
        if(NEURO.waiting) {
            stream.markdown(`Already waiting for a response from ${currentAPI}.`);

            stream.button({
                command: 'neuropilot.reconnect',
                title: 'Reconnect',
                tooltip: 'Attempt to reconnect to Neuro API',
            });

            return { metadata: { command: '' } };
        }

        // Collect references
        stream.progress('Collecting references...');

        const references: NeuroChatContext[] = [];
        for(const ref of request.references) {
            if(ref.value instanceof vscode.Location) {
                await vscode.workspace.openTextDocument(ref.value.uri).then((document) => {
                    assert(ref.value instanceof vscode.Location);
                    const text = filterFileContents(document.getText(ref.value.range));
                    references.push({
                        fileName: simpleFileName(ref.value.uri.fsPath),
                        range: ref.value.range,
                        text: text,
                    });
                });
            }
            else if(ref.value instanceof vscode.Uri) {
                await vscode.workspace.openTextDocument(ref.value).then((document) => {
                    assert(ref.value instanceof vscode.Uri);
                    const text = filterFileContents(document.getText());
                    references.push({
                        fileName: simpleFileName(ref.value.fsPath),
                        text: text,
                    });
                });
            }
            else if(typeof ref.value === 'string') {
                references.push({
                    text: filterFileContents(ref.value),
                });
            }
            else {
                logOutput('ERROR', 'Invalid reference type');
            }
        }

        // Query Neuro API
        stream.progress(`Waiting for ${currentAPI} to respond...`);

        const answer = await requestChatResponse(prefix + request.prompt, JSON.stringify({ references: references }), token);

        stream.markdown(answer);

        return { metadata: { command: '' } };
    };

    for (const participant of NEURO_PARTICIPANTS) {
        const chatter = vscode.chat.createChatParticipant(participant.id, handler);
        chatter.iconPath = vscode.Uri.joinPath(context.extensionUri, participant.relativeIconPath);

        context.subscriptions.push(chatter.onDidReceiveFeedback((feedback: vscode.ChatResultFeedback) => {
            if(feedback.kind === vscode.ChatResultFeedbackKind.Helpful) {
                logOutput('INFO', 'Answer was deemed helpful');
                NEURO.client?.sendContext('Vedal found your answer helpful.');
            }
            else {
                logOutput('INFO', 'Answer was deemed unhelpful');
                logOutput('DEBUG', JSON.stringify(feedback));
                NEURO.client?.sendContext('Vedal found your answer unhelpful.');
            }
        }));
    }
}

async function requestChatResponse(prompt: string, state: string, token: vscode.CancellationToken): Promise<string> {
    logOutput('INFO', 'Requesting chat response from Neuro');

    NEURO.waiting = true;
    NEURO.cancelled = false;

    NEURO.client?.registerActions([
        {
            name: 'chat',
            description: // TODO: https://github.com/VedalAI/neuro-game-sdk/issues/43
                'Provide an answer to Vedal\'s request.' +
                ' Use markdown to format your response.' +
                ' You may additionally include code blocks by using triple backticks.' +
                ' Be sure to use the correct language identifier after the first set of backticks.' +
                ' If you decide to include a code block, make sure to explain what it is doing.',
            schema: {
                type: 'object',
                properties: {
                    answer: { type: 'string' },
                },
                required: ['answer'],
            },
        },
    ]);

    NEURO.client?.forceActions(
        prompt,
        ['chat'],
        state,
        false,
    );

    token.onCancellationRequested(() => {
        logOutput('INFO', 'Cancelled request');
        cancelChatRequest();
    });

    const timeoutMs = CONFIG.timeout || 10000;
    const timeout = new Promise<string>((_, reject) => setTimeout(() => reject('Request timed out'), timeoutMs));
    const response = new Promise<string>((resolve) => {
        const interval = setInterval(() => {
            if(!NEURO.waiting) {
                clearInterval(interval);
                resolve(lastChatResponse);
            }
        }, 100);
    });

    try {
        return await Promise.race([timeout, response]);
    } catch(erm) {
        if(typeof erm === 'string') {
            logOutput('ERROR', erm);
            NEURO.cancelled = true;
            return erm;
        }
        else {
            throw erm;
        }
    }
}

export function cancelChatRequest() {
    NEURO.cancelled = true;
    NEURO.waiting = false;
    if(!NEURO.client) return;
    NEURO.client.unregisterActions(['chat']);
}
