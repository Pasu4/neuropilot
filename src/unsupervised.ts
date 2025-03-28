import * as vscode from 'vscode';

import { NEURO } from "./constants";
import { logOutput } from './utils';
import {
handleGitStatus,
handleGitAdd,
handleGitRevert,
handleGitCommit,
handleNewGitBranch,
handleDeleteGitBranch,
handleSwitchGitBranch,
handleNewGitRepo,
handleSetGitConfig,
handleGetGitConfig,
handleAddGitRemote,
handleRenameGitRemote,
handleRemoveGitRemote,
handleFetchGitCommits,
handlePullGitCommits,
handlePushGitCommits,
handleGitDiff,
} from './git';

import { handleTerminateTask, handleRunTask } from './tasks';
import { handleCreateFile, handleCreateFolder, handleDeleteFileOrFolder, handleRenameFileOrFolder, handleGetFiles, handleOpenFile } from './file_actions';
import { handleGetCursor, handleDeleteText, handleInsertText, handlePlaceCursor, handlePlaceCursorAtText, handleReplaceText } from './editing';

/**
 * Register unsupervised actions with the Neuro API.
 * Will only register actions that the user has given permission to use.
 */

const neuroActionHandlers: { [key: string]: (actionData: any) => void } = {
    'get_files': handleGetFiles,
    'open_file': handleOpenFile,
    'place_cursor': handlePlaceCursor,
    'get_cursor': handleGetCursor,
    'insert_text': handleInsertText,
    'replace_text': handleReplaceText,
    'delete_text': handleDeleteText,
    'place_cursor_at_text': handlePlaceCursorAtText,
    'create_file': handleCreateFile,
    'create_folder': handleCreateFolder,
    'rename_file_or_folder': handleRenameFileOrFolder,
    'delete_file_or_folder': handleDeleteFileOrFolder,
    'run_task': handleRunTask, // This is a separate, unique handler, still need to find a new home for it
    'terminate_task': handleTerminateTask,
    'init_git_repo': handleNewGitRepo,
    'new_git_branch': handleNewGitBranch,
    'add_file_to_git': handleGitAdd,
    'make_git_commit': handleGitCommit,
    'set_git_config': handleSetGitConfig,
    'get_git_config': handleGetGitConfig,
    'add_git_remote': handleAddGitRemote,
    'rename_git_remote': handleRenameGitRemote,
    'remove_git_remote': handleRemoveGitRemote,
    'fetch_git_commits': handleFetchGitCommits,
    'pull_git_commits': handlePullGitCommits,
    'push_git_commits': handlePushGitCommits,
    'delete_git_branch': handleDeleteGitBranch,
    'switch_git_branch': handleSwitchGitBranch,
    'git_status': handleGitStatus,
    'diff_files': handleGitDiff,
    'git_revert': handleGitRevert,
};

const actionKeys: string[] = Object.keys(neuroActionHandlers);

export function registerUnsupervisedActions() {
    // Unregister all actions first to properly refresh everything
    NEURO.client?.unregisterActions(actionKeys);

    if(vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false)) {
        NEURO.client?.registerActions([
            {
                name: 'add_file_to_git',
                description: 'Add a file to the staging area',
                schema: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' },
                    },
                    required: ['filePath']
                }
            },
            {
                name: 'make_git_commit',
                description: 'Commit staged changes with a message',
                schema: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' },
                    },
                    required: ['message']
                }
            },
            {
                name: 'git_status',
                description: 'Get the current status of the Git repository',
                schema: {}
            },
            {
                name: 'git_remove',
                description: 'Remove a file from the Git index',
                schema: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' },
                    },
                    required: ['filePath']
                }
            },
            {
                name: 'git_revert',
                description: 'Revert changes to a file in the Git repository',
                schema: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' },
                    },
                    required: ['filePath']
                }
            },
            {
                name: 'delete_git_branch',
                description: 'Delete a branch in the current Git repository',
                schema: {
                    type: 'object',
                    properties: {
                        branchName: { type: 'string' },
                        force: { type: 'boolean' },
                    },
                    required: ['branchName']
                }
            },
            {
                name: 'switch_git_branch',
                description: 'Switch to a different branch in the current Git repository',
                schema: {
                    type: 'object',
                    properties: {
                        branchName: { type: 'string' },
                    },
                    required: ['branchName']
                }
            },
            {
                name: 'new_git_branch',
                description: 'Create a new branch in the current Git repository',
                schema: {
                    type: 'object',
                    properties: {
                        branchName: { type: 'string' },
                    },
                    required: ['branchName'],
                }
            },
            {
                name: 'see_file_diffs',
                description: 'Get the differences between two versions of a file in the Git repository',
                schema: {
                    type: 'object',
                    properties: {
                        ref1: { type: 'string' },
                        ref2: { type: 'string' },
                        filePath: { type: 'string' },
                        diffType: { type: 'string', enum: ['diffWithHEAD', 'diffWith', 'diffIndexWithHEAD', 'diffIndexWith', 'diffBetween', 'fullDiff'] },
                    }
                }
            }
        ]);

        if(vscode.workspace.getConfiguration('neuropilot').get('permission.gitConfigs', false)) {
            NEURO.client?.registerActions([
                {
                    name: 'init_git_repo',
                    description: 'Initialize a new Git repository in the current workspace folder',
                    schema: {}
                },
                {
                    name: 'set_git_config',
                    description: 'Set a Git configuration value',
                    schema: {
                        type: 'object',
                        properties: {
                            key: { type: 'string' },
                            value: { type: 'string' },
                        },
                        required: ['key', 'value'],
                    }
                },
                {
                    name: 'get_git_config',
                    description: 'Get a Git configuration value',
                    schema: {
                        type: 'object',
                        properties: {
                            key: { type: 'string' },
                        },
                        required: ['key'],
                    }
                },
            ]);
        }

        if(vscode.workspace.getConfiguration('neuropilot').get('permission.gitRemotes', false)) {
            if(vscode.workspace.getConfiguration('neuropilot').get('permission.editRemoteData', false)) {
                NEURO.client?.registerActions([
                    {
                        name: 'add_git_remote',
                        description: 'Add a new remote to the Git repository',
                        schema: {
                            type: 'object',
                            properties: {
                                remoteName: { type: 'string' },
                                remoteURL: { type: 'string' },
                            },
                            required: ['remoteName', 'remoteURL'],
                        }
                    },
                    {
                        name: 'remove_git_remote',
                        description: 'Remove a remote from the Git repository',
                        schema: {
                            type: 'object',
                            properties: {
                                remoteName: { type: 'string' },
                            },
                            required: ['remoteName'],
                        }
                    },
                    {
                        name: 'rename_git_remote',
                        description: 'Rename a remote in the Git repository',
                        schema: {
                            type: 'object',
                            properties: {
                                oldRemoteName: { type: 'string' },
                                newRemoteName: { type: 'string' },
                            },
                            required: ['oldRemoteName', 'newRemoteName'],
                        }
                    },
                    {
                        name: 'get_git_remotes',
                        description: 'Get a list of remotes in the Git repository',
                        schema: {}
                    }
                ]);
            }
            NEURO.client?.registerActions([
                {
                    name: 'pull_git_commits',
                    description: 'Pull commits from the remote repository',
                    schema: {}
                },
                {
                    name: 'push_git_commits',
                    description: 'Push commits to the remote repository',
                    schema: {
                        type: 'object',
                        properties: {
                            remoteName: { type: 'string' },
                            branchName: { type: 'string' },
                            forcePush: { type: 'boolean' },
                        }
                    }
                }
            ]);
        }
    }

    if(vscode.workspace.getConfiguration('neuropilot').get('permission.openFiles', false)) {
        NEURO.client?.registerActions([
            {
                name: 'get_files',
                description: 'Get a list of files in the workspace',
            },
            {
                name: 'open_file',
                description: 'Open a file in the workspace',
                schema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                    },
                    required: ['path'],
                }
            },
        ]);
    }

    if(vscode.workspace.getConfiguration('neuropilot').get('permission.editActiveDocument', false)) {
        NEURO.client?.registerActions([
            {
                name: 'place_cursor',
                description: 'Place the cursor in the current file. Line and character are zero-based.',
                schema: {
                    type: 'object',
                    properties: {
                        line: { type: 'integer' },
                        character: { type: 'integer' },
                    },
                    required: ['line', 'character'],
                }
            },
            {
                name: 'get_cursor',
                description: 'Get the current cursor position and the text surrounding it',
            },
            {
                name: 'insert_text',
                description: 'Insert code at the current cursor position',
                schema: {
                    type: 'object',
                    properties: {
                        text: { type: 'string' },
                    },
                    required: ['text'],
                }
            },
            {
                name: 'replace_text',
                description: 'Replace the first occurrence of the specified code',
                schema: {
                    type: 'object',
                    properties: {
                        oldText: { type: 'string' },
                        newText: { type: 'string' },
                    },
                    required: ['oldText', 'newText'],
                }
            },
            {
                name: 'delete_text',
                description: 'Delete the first occurrence of the specified code',
                schema: {
                    type: 'object',
                    properties: {
                        textToDelete: { type: 'string' },
                    },
                    required: ['textToDelete'],
                }
            },
            {
                name: 'place_cursor_at_text',
                description: 'Place the cursor before or after the first occurrence of the specified text',
                schema: {
                    type: 'object',
                    properties: {
                        text: { type: 'string' },
                        position: { type: 'string', enum: ['before', 'after'] },
                    },
                    required: ['text', 'position'],
                }
            },
        ]);
    }

    if(vscode.workspace.getConfiguration('neuropilot').get('permission.create', false)) {
        NEURO.client?.registerActions([
            {
                name: 'create_file',
                description: 'Create a new file at the specified path. The path should include the name of the new file.',
                schema: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' },
                    },
                    required: ['filePath'],
                }
            },
            {
                name: 'create_folder',
                description: 'Create a new folder at the specified path. The path should include the name of the new folder.',
                schema: {
                    type: 'object',
                    properties: {
                        folderPath: { type: 'string' },
                    },
                    required: ['folderPath'],
                }
            },
        ]);
    }

    if(vscode.workspace.getConfiguration('neuropilot').get('permission.rename', false)) {
        NEURO.client?.registerActions([
            {
                name: 'rename_file_or_folder',
                description: 'Rename a file or folder. Specify the full relative path for both the old and new names.',
                schema: {
                    type: 'object',
                    properties: {
                        oldPath: { type: 'string' },
                        newPath: { type: 'string' },
                    },
                    required: ['oldPath', 'newPath'],
                }
            },
        ]);
    }

    if(vscode.workspace.getConfiguration('neuropilot').get('permission.delete', false)) {
        NEURO.client?.registerActions([
            {
                name: 'delete_file_or_folder',
                description: 'Delete a file or folder. If you want to delete a folder, set the "recursive" parameter to true.',
                schema: {
                    type: 'object',
                    properties: {
                        pathToDelete: { type: 'string' },
                        recursive: { type: 'boolean' },
                    },
                    required: ['pathToDelete'],
                }
            },
        ]);
    }

    if(vscode.workspace.getConfiguration('neuropilot').get('permission.runTasks', false)) {
        NEURO.client?.registerActions([
            {
                name: 'terminate_task',
                description: 'Terminate the currently running task',
            },
        ]);
        // Tasks are registered asynchronously in reloadTasks()
    }
}

/**
 * Register unsupervised handlers for Neuro API actions.
 * The handlers will only handle actions that the user has given permission to use.
 */
export function registerUnsupervisedHandlers() {
    NEURO.client?.onAction(async (actionData) => {
        const actionName = actionData.name;
        
        if (actionName === 'request_cookie') {
            return;
        } else if (NEURO.tasks.find(task => task.id !== actionName)) {
            try {
                neuroActionHandlers[actionName](actionData);
            } catch (err) {
                NEURO.client?.sendActionResult(actionData.id, false, `Error handling action "${actionName}": ${err}`);
                logOutput('ERROR', `Error handling action "${actionName}": ${err}`);
            }
        } else {
            try {
                if (NEURO.tasks.find(task => task.id === actionName)) {
                    handleRunTask(actionData);
                } else {
                    NEURO.client?.sendActionResult(actionData.id, false, `Unknown action: ${actionName}`);
                }
            } catch (err) {
                NEURO.client?.sendActionResult(actionData.id, false, `Error handling action "${actionName}": ${err}`);
                logOutput('ERROR', `Error handling action "${actionName}": ${err}`);
            }
        }
    });
}
