import * as vscode from 'vscode';

import { NEURO } from "./constants";
import { logOutput, formatActionID } from './utils';

export function handleTerminateTask(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.runTasks', false)) {
        logOutput('WARNING', 'Neuro attempted to terminate a task, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have task permissions.');
        return;
    }

    if(NEURO.currentTaskExecution === null) {
        logOutput('INFO', 'No task currently running');
        NEURO.client?.sendActionResult(actionData.id, true, 'No task to terminate');
        return;
    }

    const exe = NEURO.currentTaskExecution;
    NEURO.currentTaskExecution = null;
    exe.terminate();
    logOutput('INFO', 'Terminated current task');
    NEURO.client?.sendActionResult(actionData.id, true, 'Terminated current task');
}

export function handleRunTask(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.runTasks', false)) {
        logOutput('WARNING', 'Neuro attempted to run a task, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have task permissions.');
        return;
    }

    if(NEURO.currentTaskExecution !== null) {
        logOutput('INFO', 'A task is already running');
        NEURO.client?.sendActionResult(actionData.id, true, 'A task is already running');
        return;
    }

    const task = NEURO.tasks.find(task => task.id === actionData.name);
    if(task === undefined) {
        logOutput('ERROR', `Task ${actionData.name} not found`);
        NEURO.client?.sendActionResult(actionData.id, false, `Task ${actionData.name} not found`);
        return;
    }

    try {
        vscode.tasks.executeTask(task.task).then(value => {
            logOutput('INFO', `Executing task ${task.id}`);
            NEURO.currentTaskExecution = value;
        });
        NEURO.client?.sendActionResult(actionData.id, true, `Executing task ${task.id}`);
    } catch(erm) {
        logOutput('ERROR', `Failed to execute task ${task.id}`);
        logOutput('DEBUG', JSON.stringify(erm));
        NEURO.client?.sendActionResult(actionData.id, false, `Failed to execute task ${task.id}`);
        return;
    }
}

export function taskEndedHandler(event: vscode.TaskEndEvent) {
    if(NEURO.connected && NEURO.client !== null && NEURO.currentTaskExecution !== null) {
        if(event.execution === NEURO.currentTaskExecution) {
            logOutput('INFO', 'Neuro task finished');
            NEURO.currentTaskExecution = null;
            vscode.commands.executeCommand('workbench.action.terminal.copyLastCommandOutput')
                .then(
                    _ => vscode.env.clipboard.readText()
                ).then(
                    text => NEURO.client?.sendContext(`Task finished! Output:\n\n\`\`\`${text}\n\`\`\``)
                );
        }
    }
}

export function reloadTasks() {
    NEURO.client?.unregisterActions(NEURO.tasks.map((task) => task.id));

    NEURO.tasks = [];

    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.runTasks', false)) {
        return;
    }

    vscode.tasks.fetchTasks().then((tasks) => {
        for(const task of tasks) {
            // Only allow tasks whose details start with '[Neuro]'
            if(task.detail?.toLowerCase().startsWith('[neuro]')) {
                const detail = task.detail?.substring(7).trim();
                logOutput('INFO', `Adding Neuro task: ${task.name}`);
                NEURO.tasks.push({
                    id: formatActionID(task.name),
                    description: detail.length > 0 ? detail : task.name,
                    task: task,
                });
            }
            else {
                logOutput('INFO', `Ignoring task: ${task.name}`);
            }
        }

        if(!vscode.workspace.getConfiguration('neuropilot').get('permission.runTasks', false)) {
            return;
        }

        NEURO.client?.registerActions(NEURO.tasks.map((task) => {
            return {
                name: task.id,
                description: task.description,
            }
        }));
    });
}