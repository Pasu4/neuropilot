/** 
 * This file's exports are not designed/intended to be used in the WebWorker build of the extension
 * This means that the web version of the extension will not have this file here (such as [VS Code for the Web](https://vscode.dev) and its [GitHub version](https://github.dev))
 * Feel free to use Node.js APIs here - they won't be a problem.
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { NEURO } from './constants';
import { checkWorkspaceTrust } from './utils';
import { logOutput, delayAsync, getFence } from './utils';
import { ActionData, actionValidationAccept, actionValidationFailure, ActionValidationResult, RCEAction, contextFailure, stripToActions } from './neuro_client_helper';
import { CONFIG, PERMISSIONS, getPermissionLevel } from './config';
import { ChildProcessWithoutNullStreams } from 'child_process';

/*
 * Extended interface for terminal sessions.
 * We now explicitly store the event emitter along with the pseudoterminal.
 */
export interface TerminalSession {
    terminal: vscode.Terminal;
    pty: vscode.Pseudoterminal;
    emitter: vscode.EventEmitter<string>;
    outputStdout?: string;
    outputStderr?: string;
    processStarted: boolean;
    shellProcess?: ChildProcessWithoutNullStreams;
    shellType: string;
}

function checkLiveTerminals(actionData: ActionData): ActionValidationResult {
    const shellType: string = actionData.params.shell;
    const session = NEURO.terminalRegistry.get(shellType);
    if (!session)
        return actionValidationFailure(`No terminal session found for shell type "${shellType}".`);
    return actionValidationAccept();
}

export const terminalAccessHandlers = {
    'execute_in_terminal': {
        name: 'execute_in_terminal',
        description: 'Run a command directly in the terminal',
        schema: {
            type: 'object',
            properties: {
                command: { type: 'string' },
                shell: { type: 'string', enum: getAvailableShellProfileNames() },
            },
            required: ['command', 'shell'],
        },
        permissions: [PERMISSIONS.terminalAccess],
        handler: handleRunCommand,
        validator: [checkWorkspaceTrust],
        promptGenerator: (actionData: ActionData) => `run "${actionData.params?.command}" in the "${actionData.params?.shell}" shell.`,
    },
    'kill_terminal_process': {
        name: 'kill_terminal_process',
        description: 'Kill a terminal process that is running.',
        schema: {
            type: 'object',
            properties: {
                shell: { type: 'string' },
            },
            required: ['shell'],
        },
        permissions: [PERMISSIONS.terminalAccess],
        handler: handleKillTerminal,
        validator: [checkLiveTerminals, checkWorkspaceTrust],
        promptGenerator: (actionData: ActionData) => `kill the "${actionData.params?.shell}" shell.`,
    },
    'get_currently_running_shells': {
        name: 'get_currently_running_shells',
        description: 'Get the list of terminal processes that are spawned.',
        permissions: [PERMISSIONS.terminalAccess],
        handler: handleGetCurrentlyRunningShells,
        validator: [checkWorkspaceTrust],
        promptGenerator: 'get the list of currently running shells.',
    },
} satisfies Record<string, RCEAction>;

export function registerTerminalActions() {
    if (getPermissionLevel(PERMISSIONS.terminalAccess)) {
        NEURO.client?.registerActions(stripToActions([
            terminalAccessHandlers.execute_in_terminal,
            terminalAccessHandlers.kill_terminal_process,
            terminalAccessHandlers.get_currently_running_shells,
        ]));
    }
}

let extContext: vscode.ExtensionContext;

export function saveContextForTerminal(context: vscode.ExtensionContext) {
    extContext = context;
}

/**
* Fetches the list of terminal configurations from the `neuropilot.terminals` setting.
*/
function getCustomTerminalConfigs(): { name: string; path: string; args?: string[] }[] {
    const config = vscode.workspace.getConfiguration('neuropilot');
    const terminals = config.get<{ name: string; path: string; args?: string[] }[]>('terminals', []);
    return terminals;
}

/**
* Returns the names of all available terminal profiles from the custom configuration.
*/
export function getAvailableShellProfileNames(): string[] {
    const terminalConfigs = getCustomTerminalConfigs();
    return terminalConfigs.map((terminal) => terminal.name);
}

/**
* Look up the shell executable and arguments for a given profile name.
* Falls back to the first terminal in the list if the profile name is not found.
*/
function getShellProfileForType(shellType: string): { shellPath: string; shellArgs?: string[] } {
    const terminalConfigs = getCustomTerminalConfigs();
    const terminal = terminalConfigs.find((t) => t.name === shellType);

    if (terminal) {
        return { shellPath: terminal.path, shellArgs: terminal.args || [] };
    }

    // Fallback to the first terminal in the list if no match is found
    if (terminalConfigs.length > 0) {
        return { shellPath: terminalConfigs[0].path, shellArgs: terminalConfigs[0].args || [] };
    }

    throw new Error(`No terminal configuration found for shell type: ${shellType}`);
}

/**
* Creates a new pseudoterminal-based session.
* This version captures output in separate STDOUT and STDERR properties.
*/
function createPseudoterminal(shellType: string, terminalName: string, vscContext: vscode.ExtensionContext = extContext): TerminalSession {
    const emitter = new vscode.EventEmitter<string>();

    const startTime: string = new Date().toLocaleString();
    const startTimePermission: boolean = CONFIG.showTimeOnTerminalStart;

    // Define the pseudoterminal.
    const pty: vscode.Pseudoterminal = {
        onDidWrite: emitter.event,
        open: () => {
            // Write an initial message when the terminal opens.
            emitter.fire(`Terminal "${terminalName}" ready${startTimePermission ? ` at ${startTime}` : ''}.\r\n`);
        },
        close: () => {
            // On terminal close, kill the spawned process if it exists.
            if (session.shellProcess) {
                session.shellProcess.kill();
            }
        },
    };

    // 50/50 chance of icon selection no longer
    const icon = vscode.Uri.joinPath(vscContext.extensionUri, 'assets/console.png');

    // Create the terminal using VS Code's API.
    const terminal = vscode.window.createTerminal({
        name: terminalName,
        pty: pty,
        iconPath: icon,
        isTransient: false,
    });

    // Create the session object.
    const session: TerminalSession = {
        terminal,
        pty,
        emitter,
        outputStdout: '',
        outputStderr: '',
        processStarted: false,
        shellProcess: undefined,
        shellType,
    };

    return session;
}

/**
* Returns an existing session for the given shell type or creates a new one.
* Uses the global NEURO.terminalRegistry.
*/
function getOrCreateTerminal(shellType: string, terminalName: string): TerminalSession {
    let session = NEURO.terminalRegistry.get(shellType);
    if (!session) {
        session = createPseudoterminal(shellType, terminalName);
        NEURO.terminalRegistry.set(shellType, session);
        session.terminal.show();
    } else {
        session.terminal.show();
    }
    return session;
}

/**
* Run command handler.
* Checks permissions, executes the command in the requested shell,
* captures STDOUT and STDERR, logs the output, and sends it to nwero.
*/
export function handleRunCommand(actionData: ActionData): string | undefined {

    // Get the command and shell.
    const command: string = actionData.params?.command;
    const shellType: string = actionData.params?.shell;

    // Get or create the terminal session for this shell.
    const session = getOrCreateTerminal(shellType, `${NEURO.currentController}: ${shellType}`);
    const outputDelay = CONFIG.terminalContextDelay;

    // Reset previous outputs.
    session.outputStdout = '';
    session.outputStderr = '';

    async function sendStdoutIfUnchangedAsync(delay: number) {
        const cachedOutput = session.outputStdout;
        await delayAsync(delay);
        if (session.outputStdout === cachedOutput) {
            const fence = getFence(session.outputStdout!);
            NEURO.client?.sendContext(
                `The ${shellType} terminal outputted the following to stdout:\n\n${fence}\n${session.outputStdout!.replace(/\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7F]|\x1b\]0;.+\r?\n/g, '')}\n${fence}`,
                false,
            );
            session.outputStdout = '';
        }
    }

    async function sendStderrIfUnchangedAsync(delay: number) {
        const cachedOutput = session.outputStderr;
        await delayAsync(delay);
        if (session.outputStderr === cachedOutput) {
            const fence = getFence(session.outputStderr!);
            NEURO.client?.sendContext(
                `The ${shellType} terminal outputted the following to stderr:\n\n${fence}\n${session.outputStderr!.replace(/\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7F]|\x1b\]0;.+\r?\n/g, '')}\n${fence}`,
                false,
            );
            session.outputStderr = '';
        }
    }

    // If no process has been started, spawn it.
    if (!session.processStarted) {
        session.processStarted = true;
        const { shellPath, shellArgs } = getShellProfileForType(shellType);

        logOutput('DEBUG', `Shell: ${shellPath} ${shellArgs}`);

        if (!shellPath || typeof shellPath !== 'string')
            return `Couldn't determine executable for shell profile ${shellType}`;

        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        session.shellProcess = spawn(shellPath, shellArgs || [], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
        const proc = session.shellProcess;

        proc.stdout.on('data', (data: Buffer) => {
            const text = data.toString();
            session.outputStdout += text;
            session.emitter.fire(text.replace(/(?<!\r)\n/g, '\r\n'));
            sendStdoutIfUnchangedAsync(outputDelay);
            logOutput('DEBUG', `STDOUT: ${text}`);
        });

        proc.stderr.on('data', (data: Buffer) => {
            const text = data.toString();
            session.outputStderr += text;
            session.emitter.fire(text.replace(/(?<!\r)\n/g, '\r\n'));
            sendStderrIfUnchangedAsync(outputDelay);
            logOutput('ERROR', `STDERR: ${text}`);
        });

        proc.on('exit', (code) => {
            NEURO.client?.sendContext(code === null ? `The ${shellType} terminal closed with a null exit code. Someone did something to it.` : `Terminal ${shellType} exited with code ${code}.`);
            logOutput('INFO', `${shellType} process exited with code ${code}`);
        });

        proc.stdin.write(command + '\n');
        logOutput('DEBUG', `Sent command: ${command}`);

    } else {
        // Process is already running; send the new command via stdin.
        const shellProcess = session.shellProcess;
        if (shellProcess && shellProcess.stdin.writable) {
            shellProcess.stdin.write(command + '\n');
            logOutput('DEBUG', `Sent command: ${command}`);
        } else {
            return 'Unable to write to shell process.';
        }
    }
}

/**
 * Kill terminal handler.
 * Checks if the terminal registry contains the open shell and forcefully kills the shell if found.
 */
export function handleKillTerminal(actionData: ActionData): string | undefined {
    // Validate shell type parameter.
    const shellType: string = actionData.params?.shell;
    const session = NEURO.terminalRegistry.get(shellType)!;

    // Dispose of the terminal and remove it from the registry.
    session.terminal.dispose();
    NEURO.terminalRegistry.delete(shellType);

    // Notify Neuro and the user.
    return `Terminal session for shell type "${shellType}" has been terminated.`;
}

/**
 * Returns a list of currently running shell types.
 * Each entry includes the shell type and its status.
 */
export function handleGetCurrentlyRunningShells(_actionData: ActionData): string | undefined {
    const runningShells: string[] = [];

    for (const [shellType, session] of NEURO.terminalRegistry.entries()) {
        const status = session.shellProcess && !session.shellProcess.killed ? 'Running' : 'Stopped';
        runningShells.push(`Name: ${shellType}\nStatus: ${status}\n`);
    }

    if (runningShells.length === 0)
        return contextFailure('No running shells found.');
    else
        return `Currently running shells: ${runningShells.join('\n')}`;
}

/**
 * Forcefully kills all active terminals in the NEURO.terminalRegistry.
 * This function is intended for emergency use and will terminate all terminals regardless of their state.
 * Use with caution. Killing multiple active shells can corrupt your files.
 */
export function emergencyTerminalShutdown() {
    // Check if there are any active terminals in the registry.
    if (NEURO.terminalRegistry.size === 0) {
        logOutput('INFO', 'No active terminals to shut down.');
        return;
    }

    logOutput('INFO', 'Initiating emergency shutdown of all terminals...');

    let failedShutdownCount = 0;
    const failedShutdownTerminals: string[] = [];

    // Iterate through all terminal sessions in the registry.
    for (const [shellType, session] of NEURO.terminalRegistry.entries()) {
        try {
            // Dispose of the terminal.
            session.terminal.dispose();
            logOutput('INFO', `Terminal session for shell type "${shellType}" has been terminated.`);
        } catch (erm) {
            logOutput('ERROR', `Failed to terminate terminal session for shell type "${shellType}": ${erm}`);
            failedShutdownTerminals.push(shellType);
            failedShutdownCount += 1;
        }
    }

    // Clear the terminal registry.
    NEURO.terminalRegistry.clear();

    // Notify Neuro and log the shutdown.
    NEURO.client?.sendContext('Emergency shutdown: All terminal sessions have been forcefully terminated.');
    if (failedShutdownCount == 0) {
        logOutput('INFO', 'Emergency shutdown complete. All terminals have been terminated.');
    } else {
        logOutput('WARN', `Failed to terminate ${failedShutdownCount} shells, including: ${failedShutdownTerminals}.`);
        vscode.window.showWarningMessage(`Failed to terminate ${failedShutdownCount} terminal(s), which include these terminals: ${failedShutdownTerminals}.\nPlease check on them.`);
    }
}
