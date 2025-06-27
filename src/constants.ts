import * as vscode from 'vscode';
import { NeuroClient } from 'neuro-game-sdk';
import { TerminalSession } from './pseudoterminal';
import { RceRequest } from './rce';
import type { GitExtension } from './types/git.d';

export interface NeuroTask {
    id: string;
    description: string;
    task: vscode.Task;
}

interface Neuro {
    /** Whether or not the NeuroClient connection has been initialized. */
    initialized: boolean;
    /** Stores the NeuroClient class from the SDK being used. */
    client: NeuroClient | null;
    /** The WebSocket URL set to be connected to. */
    url: string;
    /** The set name of the "game", which is sent to Neuro. */
    gameName: string;
    /** Whether the client successfully connected to the API. */
    connected: boolean;
    /**
     * Whether this extension is currently waiting on a response, agnostic of whether the last request was canceled.
     * This is used to prevent multiple `actions/force` requests from being sent at the same time.
     */
    waiting: boolean;
    /**
     * Whether the last request was canceled.
     * This is used to tell Neuro that the request was canceled.
     */
    cancelled: boolean;
    /** The extension's output channel (logging) */
    outputChannel: vscode.OutputChannel | null;
    /** Whether Neuro has asked for a cookie. */
    waitingForCookie: boolean;
    /** The array of tasks that Neuro can execute. */
    tasks: NeuroTask[];
    /** Stores the currently executed task. */
    currentTaskExecution: vscode.TaskExecution | null;
    /** Whether the current action has been handled. */
    actionHandled: boolean;
    /** Whether or not terminals are currently running. */
    terminalEnabled: boolean;
    /** The map of terminals currently active. */
    terminalRegistry: Map<string, TerminalSession>;
    /** This is needed because VSCode doesn't say what changed, only what files were changed. */
    previousDiagnosticsMap: Map<string, vscode.Diagnostic[]>;
    /** Whether or not Neuro is manually saving. */
    saving: boolean;
    /** Stores the current RCE request prompt & callback. */
    rceRequest: RceRequest | null;
    /** Stores the state of the status bar item. */
    statusBarItem: vscode.StatusBarItem | null;
    /** Whether or not to warn when requesting completions while the relevant permission is disabled. */
    warnOnCompletionsOff: boolean;
    /**
     * The current offset of the virtual cursor for each file.
     * The offset is null for files that are not Neuro-safe.
     */
    cursorOffsets: Map<vscode.Uri, number | null>;
    /** Decoration type for the virtual cursor. */
    cursorDecorationType: vscode.TextEditorDecorationType | null;
    /** Current name set as the API controller */
    currentController: string | null;
}


export const NEURO: Neuro = {
    initialized: false,
    client: null,
    url: 'ws://localhost:8000',
    gameName: 'Visual Studio Code',
    connected: false,
    waiting: false,
    cancelled: false,
    outputChannel: null,
    waitingForCookie: false,
    tasks: [],
    currentTaskExecution: null,
    actionHandled: false,
    terminalEnabled: false,
    terminalRegistry: new Map(),
    previousDiagnosticsMap: new Map(),
    saving: false,
    rceRequest: null,
    statusBarItem: null,
    warnOnCompletionsOff: true,
    cursorOffsets: new Map(),
    cursorDecorationType: null,
    currentController: null,
};

interface ExtensionDependencies {
    copilotChat: boolean;
    git: GitExtension | null;
}

export const EXTENSIONS: ExtensionDependencies = {
    copilotChat: false,
    git: null,
};
