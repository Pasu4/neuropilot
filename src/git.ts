import * as vscode from 'vscode';
import { EXTENSIONS, NEURO } from './constants';
import type { Change, CommitOptions, Commit, Repository, API } from './types/git.d';
import { ForcePushMode } from './types/git.d';
import { StatusStrings, RefTypeStrings } from './types/git_status';
import { logOutput, simpleFileName, isPathNeuroSafe, normalizePath, getWorkspacePath } from './utils';
import { ActionData, ActionValidationResult, actionValidationAccept, actionValidationFailure, RCEAction, contextFailure, stripToActions } from './neuro_client_helper';
import { PERMISSIONS, getPermissionLevel } from './config';
import assert from 'node:assert';

/* All actions located in here requires neuropilot.permission.gitOperations to be enabled. */

// Get the Git extension
let git: API | null = null;
let repo: Repository | null = null;

export function getGitExtension() {
    if (EXTENSIONS.git) {
        git = EXTENSIONS.git.getAPI(1);
        logOutput('DEBUG', 'Git extension obtained.');
        repo = git.repositories[0];
        logOutput('DEBUG', 'Git repo obtained.');
    } else {
        git = null;
        repo = null;
    }
}

function gitValidator(_actionData: ActionData): ActionValidationResult {
    if (!git)
        return actionValidationFailure('Git extension not available.');
    if (!repo)
        return actionValidationFailure('You are not in a repository.');

    return actionValidationAccept();
}

async function neuroSafeValidationHelper(filePath: string): Promise<ActionValidationResult> {
    const absolutePath = getAbsoluteFilePath(filePath);
    if (!isPathNeuroSafe(absolutePath)) {
        return actionValidationFailure('You are not allowed to access this file path.');
    }

    const fileUri = vscode.Uri.file(absolutePath);
    try {
        await vscode.workspace.fs.stat(fileUri);
        return actionValidationAccept();
    } catch {
        return actionValidationFailure(`File ${filePath} does not exist.`);
    }
}

async function filePathGitValidator(actionData: ActionData): Promise<ActionValidationResult> {
    if (actionData.params.filePath === '') {
        return actionValidationFailure('No file path specified.', true);
    };

    const filePath: string | string[] = actionData.params?.filePath;
    if (typeof filePath === 'string') {
        const result = await neuroSafeValidationHelper(filePath);
        if (!result.success) return result;
    }
    else if (Array.isArray(filePath)) {
        for (const file of filePath) {
            const result = await neuroSafeValidationHelper(file);
            if (!result.success) return result;
        }
    }

    return actionValidationAccept();
}

function gitDiffValidator(actionData: ActionData): ActionValidationResult {
    const diffType: string = actionData.params?.diffType ?? 'diffWithHEAD';
    switch (diffType) {
        case 'diffWithHEAD':
            if (actionData.params?.ref1 || actionData.params?.ref2) {
                return actionValidationAccept('Neither "ref1" nor "ref2" is needed.');
            }
            return actionValidationAccept();
        case 'diffWith':
            if (actionData.params?.ref1 && actionData.params?.ref2) {
                return actionValidationAccept('Only "ref1" is needed for the "diffWith" diff type.');
            } else if (!actionData.params?.ref1) {
                return actionValidationFailure('"ref1" is required for the diff type of "diffWith"', true);
            } else {
                return actionValidationAccept();
            }
        case 'diffIndexWithHEAD':
            if (actionData.params?.ref1 || actionData.params?.ref2) {
                return actionValidationAccept('Neither "ref1" nor "ref2" is needed.');
            }
            return actionValidationAccept();
        case 'diffIndexWith':
            if (actionData.params?.ref1 && actionData.params?.ref2) {
                return actionValidationAccept('Only "ref1" is needed for the "diffIndexWith" diff type.');
            } else if (!actionData.params?.ref1) {
                return actionValidationFailure('"ref1" is required for the diff type of "diffIndexWith"', true);
            } else {
                return actionValidationAccept();
            }
        case 'diffBetween':
            if (!actionData.params?.ref1 || !actionData.params?.ref2) {
                return actionValidationFailure('"ref1" AND "ref2" is required for the diff type of "diffWith"', true);
            } else {
                return actionValidationAccept();
            }
        case 'fullDiff':
            if (actionData.params?.ref1 || actionData.params?.ref2) {
                return actionValidationAccept('Neither "ref1" nor "ref2" is needed.');
            }
            return actionValidationAccept();
        default:
            return actionValidationFailure('Unknown diff type.');
    }
}

export const gitActions = {
    init_git_repo: {
        name: 'init_git_repo',
        description: 'Initialize a new Git repository in the current workspace folder',
        permissions: [PERMISSIONS.gitOperations],
        handler: handleNewGitRepo,
        promptGenerator: 'initialize a Git repository in the workspace.',
        validator: [(_actionData: ActionData) => {
            if (!git) return actionValidationFailure('Git extension not available.');
            return actionValidationAccept();
        }],
    },
    add_file_to_git: {
        name: 'add_file_to_git',
        description: 'Add a file to the staging area',
        schema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    uniqueItems: true,
                },
            },
            required: ['filePath'],
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleAddFileToGit,
        promptGenerator: (actionData: ActionData) => `add the file "${actionData.params.filePath}" to the staging area.`,
        validator: [gitValidator, filePathGitValidator],
    },
    make_git_commit: {
        name: 'make_git_commit',
        description: 'Commit staged changes with a message',
        schema: {
            type: 'object',
            properties: {
                message: { type: 'string' },
                options: {
                    type: 'array',
                    items: { type: 'string', enum: ['signoff', 'verbose', 'amend'] },
                },
            },
            required: ['message'],
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleMakeGitCommit,
        promptGenerator: (actionData: ActionData) => `commit changes with the message "${actionData.params.message}".`,
        validator: [gitValidator],
    },
    merge_to_current_branch: {
        name: 'merge_to_current_branch',
        description: 'Merge another branch into the current branch.',
        schema: {
            type: 'object',
            properties: {
                ref_to_merge: { type: 'string' },
            },
            required: ['ref_to_merge'],
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleGitMerge,
        promptGenerator: (actionData: ActionData) => `merge "${actionData.params.ref_to_merge}" into the current branch.`,
        validator: [gitValidator],
    },
    git_status: {
        name: 'git_status',
        description: 'Get the current status of the Git repository',
        permissions: [PERMISSIONS.gitOperations],
        handler: handleGitStatus,
        promptGenerator: 'get the repository\'s Git status.',
        validator: [gitValidator],
    },
    remove_file_from_git: {
        name: 'remove_file_from_git',
        description: 'Remove a file from the staging area',
        schema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    uniqueItems: true,
                },
            },
            required: ['filePath'],
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleRemoveFileFromGit,
        promptGenerator: (actionData: ActionData) => `remove the file "${actionData.params.filePath}" from the staging area.`,
        validator: [gitValidator, filePathGitValidator],
    },
    delete_git_branch: {
        name: 'delete_git_branch',
        description: 'Delete a branch in the current Git repository',
        schema: {
            type: 'object',
            properties: {
                branchName: { type: 'string' },
                force: { type: 'boolean' },
            },
            required: ['branchName'],
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleDeleteGitBranch,
        promptGenerator: (actionData: ActionData) => `delete the branch "${actionData.params.branchName}".`,
        validator: [gitValidator],
    },
    switch_git_branch: {
        name: 'switch_git_branch',
        description: 'Switch to a different branch in the current Git repository',
        schema: {
            type: 'object',
            properties: {
                branchName: { type: 'string' },
            },
            required: ['branchName'],
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleSwitchGitBranch,
        promptGenerator: (actionData: ActionData) => `switch to the branch "${actionData.params.branchName}".`,
        validator: [gitValidator],
    },
    new_git_branch: {
        name: 'new_git_branch',
        description: 'Create a new branch in the current Git repository',
        schema: {
            type: 'object',
            properties: {
                branchName: { type: 'string' },
            },
            required: ['branchName'],
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleNewGitBranch,
        promptGenerator: (actionData: ActionData) => `create a new branch "${actionData.params.branchName}".`,
        validator: [gitValidator],
    },
    diff_files: {
        name: 'diff_files',
        description: 'Get the differences between two versions of a file in the Git repository',
        schema: {
            type: 'object',
            properties: {
                ref1: { type: 'string' },
                ref2: { type: 'string' },
                filePath: { type: 'string' },
                diffType: { type: 'string', enum: ['diffWithHEAD', 'diffWith', 'diffIndexWithHEAD', 'diffIndexWith', 'diffBetween', 'fullDiff'] },
            },
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleDiffFiles,
        promptGenerator: (actionData: ActionData) => `obtain ${actionData.params?.filePath ? `"${actionData.params.filePath}"'s` : 'a'} Git diff${actionData.params?.ref1 && actionData.params?.ref2 ? ` between ${actionData.params.ref1} and ${actionData.params.ref2}` : actionData.params?.ref1 ? ` at ref ${actionData.params.ref1}` : ''}${actionData.params?.diffType ? ` (of type "${actionData.params.diffType}")` : ''}.`,
        validator: [gitValidator, filePathGitValidator, gitDiffValidator],
    },
    git_log: {
        name: 'git_log',
        description: 'Get the commit history of the current branch',
        schema: {
            type: 'object',
            properties: {
                log_limit: {
                    type: 'integer',
                    minimum: 1,
                },
            },
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleGitLog,
        promptGenerator: (actionData: ActionData) => `get the ${actionData.params?.log_limit ? `${actionData.params.log_limit} most recent commits in the ` : ''}Git log.`,
        validator: [gitValidator],
    },
    git_blame: {
        name: 'git_blame',
        description: 'Get commit attributions for each line in a file.',
        schema: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
            },
            required: ['filePath'],
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleGitBlame,
        promptGenerator: (actionData: ActionData) => `get the Git blame for the file "${actionData.params.filePath}".`,
        validator: [gitValidator, filePathGitValidator],
    },

    // Requires gitTags
    tag_head: {
        name: 'tag_head',
        description: 'Tag the current commit using Git.',
        schema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                upstream: { type: 'string' },
            },
            required: ['name', 'upstream'],
        },
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitTags],
        handler: handleTagHEAD,
        promptGenerator: (actionData: ActionData) => `tag the current commit with the name "${actionData.params.name}" and associate it with the "${actionData.params.upstream}" remote.`,
        validator: [gitValidator],
    },
    delete_tag: {
        name: 'delete_tag',
        description: 'Delete a tag from Git.',
        schema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
            required: ['name'],
        },
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitTags],
        handler: handleDeleteTag,
        promptGenerator: (actionData: ActionData) => `delete the tag "${actionData.params.name}".`,
        validator: [gitValidator],
    },

    // Requires gitConfigs
    set_git_config: {
        name: 'set_git_config',
        description: 'Set a Git configuration value',
        schema: {
            type: 'object',
            properties: {
                key: { type: 'string' },
                value: { type: 'string' },
            },
            required: ['key', 'value'],
        },
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitConfigs],
        handler: handleSetGitConfig,
        promptGenerator: (actionData: ActionData) => `set the Git config key "${actionData.params.key}" to "${actionData.params.value}".`,
        validator: [gitValidator],
    },
    get_git_config: {
        name: 'get_git_config',
        description: 'Get a Git configuration value',
        schema: {
            type: 'object',
            properties: {
                key: { type: 'string' },
            },
        },
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitConfigs],
        handler: handleGetGitConfig,
        promptGenerator: (actionData: ActionData) => actionData.params?.key ? `get the Git config key "${actionData.params.key}".` : 'get the Git config.',
        validator: [gitValidator],
    },

    // Requires gitRemotes
    fetch_git_commits: {
        name: 'fetch_git_commits',
        description: 'Fetch commits from the remote repository',
        schema: {
            type: 'object',
            properties: {
                remoteName: { type: 'string' },
                branchName: { type: 'string' },
            },
        },
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitRemotes],
        handler: handleFetchGitCommits,
        promptGenerator: (actionData: ActionData) => {
            if (actionData.params.remoteName && actionData.params.branchName)
                return `fetch commits ${actionData.params.remoteName}/${actionData.params.branchName}.`;
            else if (actionData.params.remoteName)
                return `fetch commits from ${actionData.params.remoteName}.`;
            else if (actionData.params.branchName)
                return `fetch commits from ${actionData.params.branchName}.`;
            return 'fetch commits.';
        },
        validator: [gitValidator],
    },
    pull_git_commits: {
        name: 'pull_git_commits',
        description: 'Pull commits from the remote repository',
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitRemotes],
        handler: handlePullGitCommits,
        promptGenerator: 'pull commits.',
        validator: [gitValidator],
    },
    push_git_commits: {
        name: 'push_git_commits',
        description: 'Push commits to the remote repository',
        schema: {
            type: 'object',
            properties: {
                remoteName: { type: 'string' },
                branchName: { type: 'string' },
                forcePush: { type: 'boolean' },
            },
        },
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitRemotes],
        handler: handlePushGitCommits,
        promptGenerator: (actionData: ActionData) => {
            const force = actionData.params.forcePush ? 'force ' : '';
            if (actionData.params.remoteName && actionData.params.branchName)
                return `${force}push commits to ${actionData.params.remoteName}/${actionData.params.branchName}.`;
            else if (actionData.params.remoteName)
                return `${force}push commits to ${actionData.params.remoteName}.`;
            else if (actionData.params.branchName)
                return `${force}push commits to ${actionData.params.branchName}.`;
            return `${force}push commits.`;
        },
        validator: [gitValidator],
    },

    // Requires gitRemotes and editRemoteData
    add_git_remote: {
        name: 'add_git_remote',
        description: 'Add a new remote to the Git repository',
        schema: {
            type: 'object',
            properties: {
                remoteName: { type: 'string' },
                remoteURL: { type: 'string' },
            },
            required: ['remoteName', 'remoteURL'],
        },
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitRemotes, PERMISSIONS.editRemoteData],
        handler: handleAddGitRemote,
        promptGenerator: (actionData: ActionData) => `add a new remote "${actionData.params.remoteName}" with URL "${actionData.params.remoteURL}".`,
        validator: [gitValidator],
    },
    remove_git_remote: {
        name: 'remove_git_remote',
        description: 'Remove a remote from the Git repository',
        schema: {
            type: 'object',
            properties: {
                remoteName: { type: 'string' },
            },
            required: ['remoteName'],
        },
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitRemotes, PERMISSIONS.editRemoteData],
        handler: handleRemoveGitRemote,
        promptGenerator: (actionData: ActionData) => `remove the remote "${actionData.params.remoteName}".`,
        validator: [gitValidator],
    },
    rename_git_remote: {
        name: 'rename_git_remote',
        description: 'Rename a remote in the Git repository',
        schema: {
            type: 'object',
            properties: {
                oldRemoteName: { type: 'string' },
                newRemoteName: { type: 'string' },
            },
            required: ['oldRemoteName', 'newRemoteName'],
        },
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitRemotes, PERMISSIONS.editRemoteData],
        handler: handleRenameGitRemote,
        promptGenerator: (actionData: ActionData) => `rename the remote "${actionData.params.oldRemoteName}" to "${actionData.params.newRemoteName}".`,
    },
    abort_merge: {
        name: 'abort_merge',
        description: 'Aborts the current merge operation.',
        permissions: [PERMISSIONS.gitOperations],
        handler: handleAbortMerge,
        promptGenerator: 'abort the current merge operation.',
        validator: [gitValidator],
    },
} satisfies Record<string, RCEAction>;

// Get the current Git repository
// let repo: Repository | undefined = git.repositories[0];
// Handle git repo checks in each handler
// eg.
// if (!git)
//     return actionResultFailure(NO_GIT_STRING);

// Register all git commands
export function registerGitActions() {
    if (git) {
        if (getPermissionLevel(PERMISSIONS.gitOperations)) {
            NEURO.client?.registerActions(stripToActions([
                gitActions.init_git_repo,
            ]));

            const root = vscode.workspace.workspaceFolders?.[0].uri;
            if (!root) return;

            git.openRepository(root).then((r) => {
                if (r === null) {
                    repo = null;
                    return;
                }

                repo = r;

                if (repo) {
                    NEURO.client?.registerActions(stripToActions([
                        gitActions.add_file_to_git,
                        gitActions.make_git_commit,
                        gitActions.merge_to_current_branch,
                        gitActions.git_status,
                        gitActions.remove_file_from_git,
                        gitActions.delete_git_branch,
                        gitActions.switch_git_branch,
                        gitActions.new_git_branch,
                        gitActions.diff_files,
                        gitActions.git_log,
                        gitActions.git_blame,
                    ]));

                    if (getPermissionLevel(PERMISSIONS.gitTags)) {
                        NEURO.client?.registerActions(stripToActions([
                            gitActions.tag_head,
                            gitActions.delete_tag,
                        ]));
                    }

                    if (getPermissionLevel(PERMISSIONS.gitConfigs)) {
                        NEURO.client?.registerActions(stripToActions([
                            gitActions.set_git_config,
                            gitActions.get_git_config,
                        ]));
                    }

                    if (getPermissionLevel(PERMISSIONS.gitRemotes)) {
                        NEURO.client?.registerActions(stripToActions([
                            gitActions.fetch_git_commits,
                            gitActions.pull_git_commits,
                            gitActions.push_git_commits,
                        ]));

                        if (getPermissionLevel(PERMISSIONS.editRemoteData)) {
                            NEURO.client?.registerActions(stripToActions([
                                gitActions.add_git_remote,
                                gitActions.remove_git_remote,
                                gitActions.rename_git_remote,
                            ]));
                        }
                    }
                }
            });
        }
    }
}

/**
 * Actions with the Git repo
 * Requires neuropilot.permission.gitConfig to be enabled.
 */

export function handleNewGitRepo(_actionData: ActionData): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0)
        return contextFailure('No workspace folder is open.');

    const folderPath = workspaceFolders[0].uri.fsPath;

    git!.init(vscode.Uri.file(folderPath)).then(() => {
        repo = git!.repositories[0]; // Update the repo reference to the new repository, just in case
        registerGitActions(); // Re-register commands
        NEURO.client?.sendContext('Initialized a new Git repository in the workspace folder. You should now be able to use git commands.');
    }, (erm: string) => {
        NEURO.client?.sendContext('Failed to initialize Git repository');
        logOutput('ERROR', `Failed to initialize Git repository: ${erm}`);
    });
}

export function handleGetGitConfig(actionData: ActionData): string | undefined {
    assert(repo);
    const configKey: string | undefined = actionData.params.key;

    if (!configKey) {
        repo.getConfigs().then((configs: { key: string; value: string; }[]) => {
            NEURO.client?.sendContext(`Git config:\n${configs.map((config) =>
                `- ${config.key}: ${config.value}`,
            ).join('\n')}`);
            return;
        });
    }
    else {
        repo.getConfig(configKey).then((configValue: string) => {
            NEURO.client?.sendContext(`Git config key "${configKey}": ${configValue}`);
        }, (erm: string) => {
            NEURO.client?.sendContext(`Failed to get Git config key "${configKey}"`);
            logOutput('ERROR', `Failed to get Git config key "${configKey}": ${erm}`);
        });
    }

    return;
}

export function handleSetGitConfig(actionData: ActionData): string | undefined {
    assert(repo);
    const configKey: string = actionData.params.key;
    const configValue: string = actionData.params.value;

    repo.setConfig(configKey, configValue).then(() => {
        NEURO.client?.sendContext(`Set Git config key "${configKey}" to: ${configValue}`);
    }, (erm: string) => {
        NEURO.client?.sendContext(`Failed to set Git config key "${configKey}"`);
        logOutput('ERROR', `Failed to set Git config key "${configKey}": ${erm}`);
    });

    return;
}

/**
 * Actions with Git branches
 */

export function handleNewGitBranch(actionData: ActionData): string | undefined {
    assert(repo);
    const branchName: string = actionData.params.branchName;

    repo.createBranch(branchName, true).then(() => {
        NEURO.client?.sendContext(`Created and switched to new branch ${branchName}.`);
    }, (erm: string) => {
        NEURO.client?.sendContext(`Failed to create branch ${branchName}`);
        logOutput('ERROR', `Failed to create branch: ${erm}`);
    });

    return;
}

export function handleSwitchGitBranch(actionData: ActionData): string | undefined {
    assert(repo);
    const branchName: string = actionData.params.branchName;

    repo.checkout(branchName).then(() => {
        NEURO.client?.sendContext(`Switched to branch ${branchName}.`);
    }, (erm: string) => {
        NEURO.client?.sendContext(`Failed to switch to branch ${branchName}`);
        logOutput('ERROR', `Failed to switch branch: ${erm}`);
    });

    return;
}

export function handleDeleteGitBranch(actionData: ActionData): string | undefined {
    assert(repo);
    const branchName: string = actionData.params.branchName;
    const forceDelete: boolean = actionData.params.force ?? false;

    repo.deleteBranch(branchName, forceDelete).then(() => {
        NEURO.client?.sendContext(`Deleted branch ${branchName}.`);
    }, (erm: string) => {
        NEURO.client?.sendContext(`Failed to delete branch "${branchName}".${forceDelete === false ? '\nEnsure the branch is merged before deleting, or force delete it to discard changes.' : ''}`);
        logOutput('ERROR', `Failed to delete branch: ${erm}`);
    });

    return;
}

/**
 * Actions with the Git index
 */

interface StateStringProps {
    fileName?: string;
    originalFileName?: string;
    renamedFileName?: string;
    status: string
}

export function handleGitStatus(__actionData: ActionData): string | undefined {
    assert(repo);

    repo.status().then(() => {
        function translateChange(change: Change) {
            const isRename = change.renameUri !== undefined;
            return {
                fileName: !isRename ? simpleFileName(change.uri.fsPath) : undefined,
                originalFileName: isRename ? simpleFileName(change.originalUri.fsPath) : undefined,
                renamedFileName: isRename ? simpleFileName(change.renameUri.fsPath) : undefined,
                status: StatusStrings[change.status],
            };
        }
        // Can't stringify the repo state directly (because of getters I assume)
        if (!repo) return;
        const state = {
            indexChanges: repo.state.indexChanges.map((change: Change) => translateChange(change)),
            workingTreeChanges: repo.state.workingTreeChanges.map((change: Change) => translateChange(change)),
            mergeChanges: repo.state.mergeChanges.map((change: Change) => translateChange(change)),
            HEAD: {
                name: repo.state.HEAD?.name,
                type: repo.state.HEAD !== undefined ? RefTypeStrings[repo.state.HEAD.type] : undefined,
                ahead: repo.state.HEAD?.ahead,
                behind: repo.state.HEAD?.behind,
                commit: repo.state.HEAD?.commit,
                remote: repo.state.HEAD?.remote,
                upstream: repo.state.HEAD?.upstream,
            },
        };

        // Helper function to map changes
        function mapChanges(array: StateStringProps[], prefix?: string) {
            const changes: string[] = [];
            array.map((change: StateStringProps) => {
                if (change.originalFileName && change.renamedFileName) {
                    changes.push(`${prefix ?? ''}(${change.status}) ${change.originalFileName} -> ${change.renamedFileName}`);
                } else if (change.fileName) {
                    changes.push(`${prefix ?? ''}(${change.status}) ${change.fileName}`);
                } else {
                    const a = 'aeiou'.includes(change.status[0]) ? 'an' : 'a';
                    changes.push(`${prefix ?? ''}${a} ${change.status} file had some missing data.`);
                }
            });
            return changes;
        }

        // Constructing the state string
        const mergeStateString: string =
            `Index changes:\n${mapChanges(state.indexChanges, '- ').join('\n')}\n\n` +
            `Working tree changes:\n${mapChanges(state.workingTreeChanges, '- ').join('\n')}\n\n` +
            `Merge changes:\n${mapChanges(state.mergeChanges, '- ').join('\n')}\n\n`;


        const HEADUpstreamState: string =
            `       Remote branch name: ${state.HEAD.upstream?.name}\n` +
            `       On remote ${state.HEAD.upstream?.remote}\n` +
            `       ${state.HEAD.upstream?.commit ? `At commit ${state.HEAD.upstream?.commit}\n` : 'No commit on remote.\n'}`;


        const HEADStateString: string =
            'Current HEAD:\n' +
            `   Name: ${state.HEAD.name}\n` +
            `   Type: ${state.HEAD.type}\n` +
            `   At commit ${state.HEAD.commit}\n` +
            `   ${state.HEAD.upstream ? `Remote branch details:\n${HEADUpstreamState}\n` : 'No remote branch details.\n'}` +
            `   ${state.HEAD.upstream ? `Changes since last pull/push: ${state.HEAD.ahead} ahead | ${state.HEAD.behind} behind\n}` : 'No remote, so no pull/push info available.\n'}`;


        const stateStringArray: string[] = [mergeStateString, HEADStateString];

        NEURO.client?.sendContext(`Git status:\n\n${stateStringArray.join('\n')}`);
    }, (erm: string) => {
        NEURO.client?.sendContext('Failed to get Git repository status');
        logOutput('ERROR', `Failed to get Git status: ${erm}`);
    });

    return;
}

// Helper to convert a provided file path (or wildcard) to an absolute path using the workspace folder (or repo root if not available)
function getAbsoluteFilePath(filePath = '.'): string {
    // Get the workspace folder; if not available, fall back to repo root.
    const workspaceFolder = getWorkspacePath() || repo!.rootUri.fsPath;
    // Compute absolute path by joining the workspace folder with the normalized path.
    return normalizePath(workspaceFolder + '/' + filePath);
}

export function handleAddFileToGit(actionData: ActionData): string | undefined {
    assert(repo);
    const filePath: string[] = actionData.params.filePath;
    const absolutePaths: string[] = [];

    for (const path of filePath) {
        absolutePaths.push(getAbsoluteFilePath(path));
    }

    repo.add(absolutePaths).then(() => {
        NEURO.client?.sendContext(`Added files "${filePath.join(', ')}" to staging area.`);
    }, (erm: string) => {
        NEURO.client?.sendContext('Adding files to staging area failed');
        logOutput('ERROR', `Failed to git add: ${erm}\nTried to add ${absolutePaths}`);
    });
    return;
}

export function handleRemoveFileFromGit(actionData: ActionData): string | undefined {
    assert(repo);
    const filePath: string[] = actionData.params.filePath;
    const absolutePaths: string[] = [];

    for (const path of filePath) {
        absolutePaths.push(getAbsoluteFilePath(path));
    }

    repo.revert(absolutePaths).then(() => {
        NEURO.client?.sendContext(`Removed "${filePath.join(', ')}" from the index.`);
    }, (erm: string) => {
        NEURO.client?.sendContext('Removing files from the index failed');
        logOutput('ERROR', `Git remove failed: ${erm}\nTried to remove ${absolutePaths}`);
    });
    return;
}

export function handleMakeGitCommit(actionData: ActionData): string | undefined {
    assert(repo);
    const message = `${NEURO.currentController} committed: ${actionData.params?.message}`;
    const commitOptions: string[] | undefined = actionData.params?.options;
    let ExtraCommitOptions: CommitOptions | undefined = {};

    if (!commitOptions) {
        ExtraCommitOptions = undefined;
    }
    else {
        let invalidCommitOptionCheck: boolean | undefined;
        const invalidCommitOptions: string[] = [];
        commitOptions.map((option) => {
            if (!ExtraCommitOptions) return;
            switch (option) {
                case 'amend':
                    ExtraCommitOptions.amend = true;
                    break;
                case 'signoff':
                    ExtraCommitOptions.signoff = true;
                    break;
                case 'verbose':
                    ExtraCommitOptions.verbose = true;
                    break;
                default:
                    invalidCommitOptionCheck = true;
                    invalidCommitOptions.push(option);
                    break;
            }
        });
        if (invalidCommitOptionCheck === true)
            return contextFailure(`Invalid commit options: ${invalidCommitOptions.join(', ')}`);
    }

    repo.inputBox.value = message;
    repo.commit(message, ExtraCommitOptions).then(() => {
        NEURO.client?.sendContext(`Committed with message: "${message}"\nCommit options used: ${commitOptions ? commitOptions : 'None'}`);
    }, (erm: string) => {
        NEURO.client?.sendContext('Failed to record commit');
        logOutput('ERROR', `Failed to commit: ${erm}`);
    });

    return;
}

export function handleGitMerge(actionData: ActionData): string | undefined {
    assert(repo);
    const refToMerge = actionData.params.ref_to_merge;

    repo.merge(refToMerge).then(() => {
        NEURO.client?.sendContext(`Cleanly merged ${refToMerge} into the current branch.`);
    }, (erm: string) => {
        if (repo?.state.mergeChanges.some(() => true)) {
            NEURO.client?.registerActions(stripToActions([
                gitActions.abort_merge,
            ]));
        }
        NEURO.client?.sendContext(`Couldn't merge ${refToMerge}: ${erm}`);
        logOutput('ERROR', `Encountered an error when merging ${refToMerge}: ${erm}`);
    });

    return;
}

export function handleAbortMerge(_actionData: ActionData): string | undefined {
    assert(repo);

    repo.mergeAbort().then(() => {
        NEURO.client?.unregisterActions(['abort_merge']);
        NEURO.client?.sendContext('Merge aborted.');
    }, (erm: string) => {
        NEURO.client?.sendContext("Couldn't abort merging!");
        logOutput('ERROR', `Failed to abort merge: ${erm}`);
    });

    return;
}

export function handleDiffFiles(actionData: ActionData): string | undefined {
    assert(repo);

    const ref1: string | undefined = actionData.params.ref1;
    const ref2: string | undefined = actionData.params.ref2;
    const filePath: string = actionData.params.filePath ?? '.';
    const diffThisFile = getAbsoluteFilePath(filePath);

    const diffType: string = actionData.params.diffType ?? 'diffWithHEAD'; // Default to diffWithHEAD

    switch (diffType) {
        case 'diffWithHEAD':
            repo.diffWithHEAD(diffThisFile)
                .then((diff: string) => {
                    NEURO.client?.sendContext(`Diff with HEAD for ${filePath || 'workspace root'}:\n${diff}`);
                })
                .catch((erm: string) => {
                    NEURO.client?.sendContext(`Failed to get diff with HEAD for ${filePath || 'workspace root'}.`);
                    logOutput('ERROR', `Failed to get diff with HEAD for ${filePath || 'workspace root'}: ${erm}`);
                });
            break;

        case 'diffWith':
            if (ref1) {
                repo.diffWith(ref1, diffThisFile)
                    .then((diff: string) => {
                        NEURO.client?.sendContext(`Diff with ref "${ref1}" for ${filePath || 'workspace root'}:\n${diff}`);
                    })
                    .catch((erm: string) => {
                        NEURO.client?.sendContext(`Failed to get diff with ref "${ref1}" for ${filePath || 'workspace root'}.`);
                        logOutput('ERROR', `Failed to get diff with ref "${ref1}" for ${filePath || 'workspace root'}: ${erm}`);
                    });
            } else {
                NEURO.client?.sendContext('Ref1 is required for diffWith.');
            }
            break;

        case 'diffIndexWithHEAD':
            repo.diffIndexWithHEAD(diffThisFile)
                .then((diff: string) => {
                    NEURO.client?.sendContext(`Diff index with HEAD for ${filePath || 'workspace root'}:\n${diff}`);
                })
                .catch((erm: string) => {
                    NEURO.client?.sendContext(`Failed to get diff index with HEAD for ${filePath || 'workspace root'}.`);
                    logOutput('ERROR', `Failed to get diff index with HEAD for ${filePath || 'workspace root'}: ${erm}`);
                });
            break;

        case 'diffIndexWith':
            if (ref1) {
                repo.diffIndexWith(ref1, diffThisFile)
                    .then((diff: string) => {
                        NEURO.client?.sendContext(`Diff index with ref "${ref1}" for ${filePath || 'workspace root'}:\n${diff}`);
                    })
                    .catch((erm: string) => {
                        NEURO.client?.sendContext(`Failed to get diff index with ref "${ref1}" for ${filePath || 'workspace root'}.`);
                        logOutput('ERROR', `Failed to get diff index with ref "${ref1}" for ${filePath || 'workspace root'}: ${erm}`);
                    });
            } else {
                NEURO.client?.sendContext('Ref1 is required for diffIndexWith.');
            }
            break;

        case 'diffBetween':
            if (ref1 && ref2) {
                repo.diffBetween(ref1, ref2, diffThisFile)
                    .then((diff: string) => {
                        NEURO.client?.sendContext(`Diff between refs "${ref1}" and "${ref2}" for ${filePath || 'workspace root'}:\n${diff}`);
                    })
                    .catch((erm: string) => {
                        NEURO.client?.sendContext(`Failed to get diff between refs "${ref1}" and "${ref2}" for ${filePath || 'workspace root'}.`);
                        logOutput('ERROR', `Failed to get diff between refs "${ref1}" and "${ref2}" for ${filePath || 'workspace root'}: ${erm}`);
                    });
            } else {
                NEURO.client?.sendContext('Both ref1 and ref2 are required for diffBetween.');
            }
            break;

        case 'fullDiff':
            repo.diffWithHEAD(diffThisFile)
                .then((diff: string) => {
                    NEURO.client?.sendContext(`Full diff for workspace root:\n${diff}`);
                })
                .catch((erm: string) => {
                    NEURO.client?.sendContext('Failed to get full diff for workspace root.');
                    logOutput('ERROR', `Failed to get full diff for workspace root: ${erm}`);
                });
            break;

        default:
            NEURO.client?.sendContext(`Invalid diffType "${diffType}".`);
    }

    return;
}

export function handleGitLog(actionData: ActionData): string | undefined {
    assert(repo);

    const logLimit: number | undefined = actionData.params?.log_limit;

    repo.log().then((commits: Commit[]) => {
        // If log_limit is defined, restrict number of commits to that value.
        if (logLimit) {
            commits = commits.slice(0, logLimit);
        }
        // Build a readable commit log string.
        const commitLog = commits.map(commit =>
            `Commit: ${commit.hash}\nMessage: ${commit.message}\nAuthor: ${commit.authorName}\nDate: ${commit.authorDate}\n`,
        ).join('\n');

        NEURO.client?.sendContext(`Commit log:\n${commitLog}`);
    }, (erm: string) => {
        NEURO.client?.sendContext('Failed to get git log.');
        logOutput('ERROR', `Failed to get git log: ${erm}`);
    });

    return;
}

export function handleGitBlame(actionData: ActionData): string | undefined {
    assert(repo);
    const filePath: string = actionData.params.filePath;
    const absolutePath: string = getAbsoluteFilePath(filePath);

    if (!isPathNeuroSafe(absolutePath)) {
        NEURO.client?.sendContext('The provided file path is not allowed.');
        return;
    }

    repo.blame(absolutePath).then((blame: string) => {
        NEURO.client?.sendContext(`Blame attribution for ${filePath}:\n${blame}`);
    }, (erm: string) => {
        NEURO.client?.sendContext('Failed to get blame attribution.');
        logOutput('ERROR', `Error getting blame attribs for ${filePath}: ${erm}`);
    });

    return;
}

/**
 * Actions with Git tags
 * Requires neuropilot.permission.gitTags to be enabled.
 */

export function handleTagHEAD(actionData: ActionData): string | undefined {
    assert(repo);
    const name: string = actionData.params.name;
    const upstream: string = actionData.params.upstream;

    repo.tag(name, upstream).then(() => {
        NEURO.client?.sendContext(`Tag ${name} created for ${upstream} remote.`);
    }, (erm: string) => {
        NEURO.client?.sendContext('There was an error during tagging.');
        logOutput('ERROR', `Error trying to tag: ${erm}`);
    });

    return;
}

export function handleDeleteTag(actionData: ActionData): string | undefined {
    assert(repo);
    const name: string = actionData.params.name;

    repo.deleteTag(name).then(() => {
        NEURO.client?.sendContext(`Deleted tag ${name}`);
    }, (erm: string) => {
        NEURO.client?.sendContext(`Couldn't delete tag "${name}"`);
        logOutput('ERROR', `Failed to delete tag ${name}: ${erm}`);
    });

    return;
}

/**
 * Actions with Git remotes
 * Requires neuropilot.permission.gitRemotes to be enabled.
 */

export function handleFetchGitCommits(actionData: ActionData): string | undefined {
    assert(repo);
    const remoteName: string = actionData.params.remoteName;
    const branchName: string = actionData.params.branchName;

    repo.fetch(remoteName, branchName).then(() => {
        NEURO.client?.sendContext(`Fetched commits from ${remoteName ? 'remote ' + remoteName : 'default remote'}${branchName ? `, branch "${branchName}"` : ''}.`);
    }, (erm: string) => {
        NEURO.client?.sendContext(`Failed to fetch commits from remote "${remoteName}"`);
        logOutput('ERROR', `Failed to fetch commits: ${erm}`);
    });

    return;
}

export function handlePullGitCommits(_actionData: ActionData): string | undefined {
    assert(repo);

    repo.pull().then(() => {
        NEURO.client?.sendContext('Pulled commits from remote.');
    }, (erm: string) => {
        NEURO.client?.sendContext(`Failed to pull commits from remote: ${erm}`);
        logOutput('ERROR', `Failed to pull commits: ${erm}`);
    });

    return;
}

export function handlePushGitCommits(actionData: ActionData): string | undefined {
    assert(repo);
    const remoteName: string | undefined = actionData.params.remoteName;
    const branchName: string | undefined = actionData.params.branchName;
    const forcePush: boolean = actionData.params.forcePush ?? false;

    const forcePushMode: ForcePushMode | undefined = forcePush === true ? ForcePushMode.Force : undefined;

    repo.push(remoteName, branchName, true, forcePushMode).then(() => {
        NEURO.client?.sendContext(`Pushed commits${remoteName ? ` to remote "${remoteName}"` : ''}${branchName ? `, branch "${branchName}"` : ''}.${forcePush === true ? ' (forced push)' : ''}`);
    }, (erm: string) => {
        NEURO.client?.sendContext(`Failed to push commits to remote "${remoteName}": ${erm}`);
        logOutput('ERROR', `Failed to push commits: ${erm}`);
    });

    return;
}

/**
 * THESE ACTIONS ARE CONSIDERED DANGEROUS REMOTE OPERATIONS
 * Requires neuropilot.permission.editRemoteData to be enabled, IN ADDITION to neuropilot.permission.gitRemotes.
 */

export function handleAddGitRemote(actionData: ActionData): string | undefined {
    assert(repo);

    const remoteName: string = actionData.params.remoteName;
    const remoteUrl: string = actionData.params.remoteURL;

    repo.addRemote(remoteName, remoteUrl).then(() => {
        NEURO.client?.sendContext(`Added remote "${remoteName}" with URL: ${remoteUrl}`);
    }, (erm: string) => {
        NEURO.client?.sendContext(`Failed to add remote "${remoteName}"`);
        logOutput('ERROR', `Failed to add remote: ${erm}`);
    });

    return;
}

export function handleRemoveGitRemote(actionData: ActionData): string | undefined {
    assert(repo);
    const remoteName: string = actionData.params.remoteName;

    repo.removeRemote(remoteName).then(() => {
        NEURO.client?.sendContext(`Removed remote "${remoteName}".`);
    }, (erm: string) => {
        NEURO.client?.sendContext(`Failed to remove remote "${remoteName}"`);
        logOutput('ERROR', `Failed to remove remote: ${erm}`);
    });

    return;
}

export function handleRenameGitRemote(actionData: ActionData): string | undefined {
    assert(repo);
    const oldRemoteName: string = actionData.params.oldRemoteName;
    const newRemoteName: string = actionData.params.newRemoteName;

    repo.renameRemote(oldRemoteName, newRemoteName).then(() => {
        NEURO.client?.sendContext(`Renamed remote "${oldRemoteName}" to "${newRemoteName}".`);
    }, (erm: string) => {
        NEURO.client?.sendContext(`Failed to rename remote "${oldRemoteName}" to "${newRemoteName}"`);
        logOutput('ERROR', `Failed to rename remote ${oldRemoteName}: ${erm}`);
    });

    return;
}
