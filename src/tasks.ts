import * as vscode from 'vscode';

import { NEURO } from './constants';
import { logOutput, formatActionID, getFence } from './utils';
import { ActionData, ActionWithHandler, actionValidationAccept, actionValidationFailure } from './neuro_client_helper';
import { CONFIG, PERMISSIONS, getPermissionLevel } from './config';

export const taskHandlers = {
    // handleRunTask is used separately and not on this list
    terminate_task: {
        name: 'terminate_task',
        description: 'Terminate the currently running task',
        permissions: [PERMISSIONS.runTasks],
        handler: handleTerminateTask,
        promptGenerator: () => 'terminate the currently running task.',
        validator: [() => NEURO.currentTaskExecution !== null
            ? actionValidationAccept()
            : actionValidationFailure('No task to terminate.')],
    },
} satisfies Record<string, ActionWithHandler>;

export function registerTaskActions() {
    if(getPermissionLevel(PERMISSIONS.runTasks)) {
        NEURO.client?.registerActions([
            taskHandlers.terminate_task,
        ]);
        // Tasks are registered asynchronously in reloadTasks()
    }
}

export function handleTerminateTask(_actionData: ActionData): string | undefined {
    const exe = NEURO.currentTaskExecution!;
    NEURO.currentTaskExecution = null;
    exe.terminate();
    logOutput('INFO', 'Terminated current task');
    return 'Terminated current task.';
}

export function handleRunTask(actionData: ActionData): string | undefined {
    if(NEURO.currentTaskExecution !== null)
        return 'Action failed: A task is already running.';

    const task = NEURO.tasks.find(task => task.id === actionData.name);
    if(task === undefined)
        return `Action failed: Task ${actionData.name} not found.`;

    try {
        vscode.tasks.executeTask(task.task).then(value => {
            logOutput('INFO', `Executing task ${task.id}`);
            NEURO.currentTaskExecution = value;
        });
        return `Executing task ${task.id}`;
    } catch(erm) {
        logOutput('DEBUG', JSON.stringify(erm));
        return `Failed to execute task ${task.id}.`;
    }
}

export function taskEndedHandler(event: vscode.TaskEndEvent) {
    if(NEURO.connected && NEURO.client !== null && NEURO.currentTaskExecution !== null) {
        if(event.execution === NEURO.currentTaskExecution) {
            logOutput('INFO', 'Neuro task finished');
            NEURO.currentTaskExecution = null;
            vscode.commands.executeCommand('workbench.action.terminal.copyLastCommandOutput')
                .then(
                    _ => vscode.env.clipboard.readText(),
                ).then(
                    text => {
                        const fence = getFence(text);
                        NEURO.client?.sendContext(`Task finished! Output:\n\n${fence}\n${text}\n${fence}`);
                    },
                );
        }
    }
}

export function reloadTasks() {
    if(NEURO.tasks.length)
        NEURO.client?.unregisterActions(NEURO.tasks.map((task) => task.id));

    NEURO.tasks = [];

    if(!getPermissionLevel(PERMISSIONS.runTasks)) {
        return;
    }

    vscode.tasks.fetchTasks().then((tasks) => {
        for(const task of tasks) {
            if (CONFIG.allowRunningAllTasks === true) {
                logOutput('INFO', `Adding task: ${task.name}`);
                NEURO.tasks.push({
                    id: formatActionID(task.name),
                    description: (task.detail?.length ?? 0) > 0 ? task.detail! : task.name,
                    task,
                });
            } else if (task.detail?.toLowerCase().startsWith('[neuro]')) {
                // Only allow tasks whose details start with '[Neuro]'
                const detail = task.detail?.substring(7).trim();
                logOutput('INFO', `Adding Neuro task: ${task.name}`);
                NEURO.tasks.push({
                    id: formatActionID(task.name),
                    description: detail.length > 0 ? detail : task.name,
                    task,
                });
            }
            else {
                logOutput('INFO', `Ignoring task: ${task.name}`);
            }
        }

        if(!getPermissionLevel(PERMISSIONS.runTasks)) {
            return;
        }

        NEURO.client?.registerActions(NEURO.tasks.map((task) => {
            return {
                name: task.id,
                description: task.description,
            };
        }));
    });
}
