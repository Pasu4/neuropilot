import * as vscode from 'vscode';
import * as path from 'path';
import { NEURO } from './constants';
import { GitExtension, Change, ForcePushMode, CommitOptions, Commit, Repository } from './types/git';
import { StatusStrings, RefTypeStrings } from './types/git_status';
import { getNormalizedRepoPathForGit, logOutput, simpleFileName } from './utils';
import { ActionData, ActionValidationResult, actionValidationAccept, actionValidationFailure, ActionWithHandler, contextFailure } from './neuro_client_helper';
import { PERMISSIONS, getPermissionLevel } from './config';
import assert from 'assert';

/* All actions located in here requires neuropilot.permission.gitOperations to be enabled. */

// Get the Git extension
const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports;
const git = gitExtension.getAPI(1);

function gitValidator(_actionData: ActionData): ActionValidationResult {
    if (!git)
        return actionValidationFailure('Git extension not available.');
    if (!repo)
        return actionValidationFailure('You are not in a repository.');

    return actionValidationAccept();
}

export const gitActions = {
    init_git_repo: {
        name: 'init_git_repo',
        description: 'Initialize a new Git repository in the current workspace folder',
        permissions: [PERMISSIONS.gitOperations],
        handler: handleNewGitRepo,
        promptGenerator: 'Neuro wants to initialize a Git repository in the workspace.',
    },
    add_file_to_git: {
        name: 'add_file_to_git',
        description: 'Add a file to the staging area',
        schema: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
            },
            required: ['filePath'],
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleAddFileToGit,
        promptGenerator: (actionData: ActionData) => `Neuro wants to add the file "${actionData.params.filePath}" to the staging area.`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to commit changes with the message "${actionData.params.message}".`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to merge "${actionData.params.ref_to_merge}" into the current branch.`,
        validator: gitValidator,
    },
    git_status: {
        name: 'git_status',
        description: 'Get the current status of the Git repository',
        permissions: [PERMISSIONS.gitOperations],
        handler: handleGitStatus,
        promptGenerator: 'Neuro wants to get the Git status.',
        validator: gitValidator,
    },
    remove_file_from_git: {
        name: 'remove_file_from_git',
        description: 'Remove a file from the staging area',
        schema: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
            },
            required: ['filePath'],
        },
        permissions: [PERMISSIONS.gitOperations],
        handler: handleRemoveFileFromGit,
        promptGenerator: (actionData: ActionData) => `Neuro wants to remove the file "${actionData.params.filePath}" from the staging area.`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to delete the branch "${actionData.params.branchName}".`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to switch to the branch "${actionData.params.branchName}".`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to create a new branch "${actionData.params.branchName}".`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to obtain ${actionData.params?.filePath ? `${actionData.params.filePath}'s` : 'a'} Git diff${actionData.params?.ref1 && actionData.params?.ref2 ? ` between ${actionData.params.ref1} and ${actionData.params.ref2}` : actionData.params?.ref1 ? ` at ref ${actionData.params.ref1}` : ''}${actionData.params?.diffType ? ` (of type "${actionData.params.diffType}")` : ''}.`,
        validator: gitValidator,
    },
    git_log: {
        name: 'git_log',
        description: 'Get the commit history of the current branch',
        permissions: [PERMISSIONS.gitOperations],
        handler: handleGitLog,
        promptGenerator: 'Neuro wants to get the Git log.',
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to get the Git blame for the file "${actionData.params.filePath}".`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to tag the current commit with the name "${actionData.params.name}" and associate it with the "${actionData.params.upstream}" remote.`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to delete the tag "${actionData.params.name}".`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to set the Git config key "${actionData.params.key}" to "${actionData.params.value}".`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => actionData.params?.key ? `Neuro wants to get the Git config key "${actionData.params.key}".` : 'Neuro wants to get the Git config.',
        validator: gitValidator,
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
            if(actionData.params.remoteName && actionData.params.branchName)
                return `Neuro wants to fetch commits ${actionData.params.remoteName}/${actionData.params.branchName}.`;
            else if(actionData.params.remoteName)
                return `Neuro wants to fetch commits from ${actionData.params.remoteName}.`;
            else if(actionData.params.branchName)
                return `Neuro wants to fetch commits from ${actionData.params.branchName}.`;
            return 'Neuro wants to fetch commits.';
        },
        validator: gitValidator,
    },
    pull_git_commits: {
        name: 'pull_git_commits',
        description: 'Pull commits from the remote repository',
        permissions: [PERMISSIONS.gitOperations, PERMISSIONS.gitRemotes],
        handler: handlePullGitCommits,
        promptGenerator: 'Neuro wants to pull commits.',
        validator: gitValidator,
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
            if(actionData.params.remoteName && actionData.params.branchName)
                return `Neuro wants to ${force}push commits to ${actionData.params.remoteName}/${actionData.params.branchName}.`;
            else if(actionData.params.remoteName)
                return `Neuro wants to ${force}push commits to ${actionData.params.remoteName}.`;
            else if(actionData.params.branchName)
                return `Neuro wants to ${force}push commits to ${actionData.params.branchName}.`;
            return `Neuro wants to ${force}push commits.`;
        },
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to add a new remote "${actionData.params.remoteName}" with URL "${actionData.params.remoteURL}".`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to remove the remote "${actionData.params.remoteName}".`,
        validator: gitValidator,
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
        promptGenerator: (actionData: ActionData) => `Neuro wants to rename the remote "${actionData.params.oldRemoteName}" to "${actionData.params.newRemoteName}".`,
    },
    abort_merge: {
        name: 'abort_merge',
        description: 'Aborts the current merge operation.',
        permissions: [PERMISSIONS.gitOperations],
        handler: handleAbortMerge,
        promptGenerator: 'Neuro wants to abort the current merge operation.',
        validator: gitValidator,
    },
} satisfies Record<string, ActionWithHandler>;

// Get the current Git repository
let repo: Repository | undefined = git.repositories[0];
// Handle git repo checks in each handler
// eg.
// if (!git)
//     return actionResultFailure(NO_GIT_STRING);

// Register all git commands
export function registerGitActions() {
    if (getPermissionLevel(PERMISSIONS.gitOperations)) {
        NEURO.client?.registerActions([
            gitActions.init_git_repo,
        ]);

        const root = vscode.workspace.workspaceFolders?.[0].uri;
        if (!root) return;

        git.openRepository(root).then((r) => {
            if (r === null) {
                repo = undefined;
                return;
            }

            repo = r;

            if (repo) {
                NEURO.client?.registerActions([
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
                ]);

                if (getPermissionLevel(PERMISSIONS.gitTags)) {
                    NEURO.client?.registerActions([
                        gitActions.tag_head,
                        gitActions.delete_tag,
                    ]);
                }

                if (getPermissionLevel(PERMISSIONS.gitConfigs)) {
                    NEURO.client?.registerActions([
                        gitActions.set_git_config,
                        gitActions.get_git_config,
                    ]);
                }

                if (getPermissionLevel(PERMISSIONS.gitRemotes)) {
                    NEURO.client?.registerActions([
                        gitActions.fetch_git_commits,
                        gitActions.pull_git_commits,
                        gitActions.push_git_commits,
                    ]);

                    if (getPermissionLevel(PERMISSIONS.editRemoteData)) {
                        NEURO.client?.registerActions([
                            gitActions.add_git_remote,
                            gitActions.remove_git_remote,
                            gitActions.rename_git_remote,
                        ]);
                    }
                }
            }
        });
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

    git.init(vscode.Uri.file(folderPath)).then(() => {
        repo = git.repositories[0]; // Update the repo reference to the new repository, just in case
        registerGitActions(); // Re-register commands
        NEURO.client?.sendContext('Initialized a new Git repository in the workspace folder. You should now be able to use git commands.');
    }, (err: string) => {
        NEURO.client?.sendContext('Failed to initialize Git repository');
        logOutput('ERROR', `Failed to initialize Git repository: ${err}`);
    });
}

export function handleGetGitConfig(actionData: ActionData): string | undefined {
    assert(repo);
    const configKey: string | undefined = actionData.params.key;

    if (!configKey) {
        repo.getConfigs().then((configs: { key: string; value: string; }[]) => {
            NEURO.client?.sendContext(`Git config: ${JSON.stringify(configs)}`);
            return;
        });
    }
    else {
        repo.getConfig(configKey).then((configValue: string) => {
            NEURO.client?.sendContext(`Git config key "${configKey}": ${configValue}`);
        }, (err: string) => {
            NEURO.client?.sendContext(`Failed to get Git config key "${configKey}"`);
            logOutput('ERROR', `Failed to get Git config key "${configKey}": ${err}`);
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
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to set Git config key "${configKey}"`);
        logOutput('ERROR', `Failed to set Git config key "${configKey}": ${err}`);
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
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to create branch ${branchName}`);
        logOutput('ERROR', `Failed to create branch: ${err}`);
    });

    return;
}

export function handleSwitchGitBranch(actionData: ActionData): string | undefined {
    assert(repo);
    const branchName: string = actionData.params.branchName;

    repo.checkout(branchName).then(() => {
        NEURO.client?.sendContext(`Switched to branch ${branchName}.`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to switch to branch ${branchName}`);
        logOutput('ERROR', `Failed to switch branch: ${err}`);
    });

    return;
}

export function handleDeleteGitBranch(actionData: ActionData): string | undefined {
    assert(repo);
    const branchName: string = actionData.params.branchName;
    const forceDelete: boolean = actionData.params.force ?? false;

    repo.deleteBranch(branchName, forceDelete).then(() => {
        NEURO.client?.sendContext(`Deleted branch ${branchName}.`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to delete branch "${branchName}".${forceDelete === false ? '\nEnsure the branch is merged before deleting, or force delete it to discard changes.' : ''}`);
        logOutput('ERROR', `Failed to delete branch: ${err}`);
    });

    return;
}

/**
 * Actions with the Git index
 */

export function handleGitStatus(_actionData: ActionData): string | undefined {
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
                type: repo.state.HEAD !== undefined ? RefTypeStrings[repo.state.HEAD?.type] : undefined,
                ahead: repo.state.HEAD?.ahead,
                behind: repo.state.HEAD?.behind,
                commit: repo.state.HEAD?.commit,
                remote: repo.state.HEAD?.remote,
                upstream: repo.state.HEAD?.upstream,
            },
        };
        NEURO.client?.sendContext(`Git status: ${JSON.stringify(state)}`);
    }, (err: string) => {
        NEURO.client?.sendContext('Failed to get Git repository status');
        logOutput('ERROR', `Failed to get Git status: ${err}`);
    });

    return;
}

export function handleAddFileToGit(actionData: ActionData): string | undefined {
    assert(repo);
    const filePath: string = actionData.params.filePath;

    // Normalize the file path if provided; otherwise, use wildcard.
    const stageFiles: string = filePath ? getNormalizedRepoPathForGit(filePath) : '*';

    // Compute an absolute path. If the stageFiles is already absolute, use it.
    // Otherwise, join it with the repository's root path.
    let absolutePath: string;
    if (path.isAbsolute(stageFiles)) {
        absolutePath = stageFiles;
    } else {
        absolutePath = path.join(repo.rootUri.fsPath, stageFiles);
        if (stageFiles === '.') {
            absolutePath = `${absolutePath}\\${stageFiles}`;
        }
    }

    // Pass the absolute path to the Git add command.
    repo.add([absolutePath]).then(() => {
        NEURO.client?.sendContext(`Added ${stageFiles} to staging area.`);
    }, (err: string) => {
        NEURO.client?.sendContext('Adding files to staging area failed');
        logOutput('ERROR', `Failed to git add: ${err}\nTried to add ${absolutePath}`);
    });

    return;
}

export function handleRemoveFileFromGit(actionData: ActionData): string | undefined {
    assert(repo);
    const filePath: string = actionData.params.filePath;

    // Normalize the file path if provided; otherwise, use wildcard.
    const revertFiles: string = filePath ? getNormalizedRepoPathForGit(filePath) : '*';

    // Compute an absolute path. If the removeFiles is already absolute, use it.
    // Otherwise, join it with the repository's root path.
    let absolutePath: string;
    if (path.isAbsolute(revertFiles)) {
        absolutePath = revertFiles;
    } else {
        absolutePath = path.join(repo.rootUri.fsPath, revertFiles);
        if (revertFiles === '.') {
            absolutePath = `${absolutePath}\\${revertFiles}`;
        }
    }

    // Pass the absolute path to the Git remove command.
    repo.revert([absolutePath]).then(() => {
        NEURO.client?.sendContext(`Removed ${revertFiles} from the index.`);
    }, (err: string) => {
        NEURO.client?.sendContext('Removing files from the index failed');
        logOutput('ERROR', `Git remove failed: ${err}\nTried to remove ${absolutePath}`);
    });

    return;
}

export function handleMakeGitCommit(actionData: ActionData): string | undefined {
    assert(repo);
    const message = `Neuro commit: ${actionData.params?.message}`;
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
            switch(option) {
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
    }, (err: string) => {
        NEURO.client?.sendContext('Failed to record commit');
        logOutput('ERROR', `Failed to commit: ${err}`);
    });

    return;
}

export function handleGitMerge(actionData: ActionData): string | undefined {
    assert(repo);
    const refToMerge = actionData.params.ref_to_merge;

    repo.merge(refToMerge).then(() => {
        NEURO.client?.sendContext(`Cleanly merged ${refToMerge} into the current branch.`);
    }, (err: string) => {
        if (repo?.state.mergeChanges.some(() => true)) {
            NEURO.client?.registerActions([
                gitActions.abort_merge,
            ]);
        }
        NEURO.client?.sendContext(`Couldn't merge ${refToMerge}: ${err}`);
        logOutput('ERROR', `Encountered an error when merging ${refToMerge}: ${err}`);
    });

    return;
}

export function handleAbortMerge(_actionData: ActionData): string | undefined {
    assert(repo);

    repo.mergeAbort().then(() => {
        NEURO.client?.unregisterActions(['abort_merge']);
        NEURO.client?.sendContext('Merge aborted.');
    }, (err: string) => {
        NEURO.client?.sendContext("Couldn't abort merging!");
        logOutput('ERROR', `Failed to abort merge: ${err}`);
    });

    return;
}

export function handleDiffFiles(actionData: ActionData): string | undefined {
    assert(repo);

    const ref1: string | undefined = actionData.params.ref1;
    const ref2: string | undefined = actionData.params.ref2;
    const filePath: string = actionData.params.filePath ?? '.';
    const diffType: string = actionData.params.diffType ?? 'diffWithHEAD'; // Default to diffWithHEAD

    // Get the normalized workspace root path
    const diffThisFile = getNormalizedRepoPathForGit(filePath);

    switch (diffType) {
        case 'diffWithHEAD':
            repo.diffWithHEAD(diffThisFile)
                .then((diff: string) => {
                    NEURO.client?.sendContext(`Diff with HEAD for ${filePath || 'workspace root'}:\n${diff}`);
                })
                .catch((err: string) => {
                    NEURO.client?.sendContext(`Failed to get diff with HEAD for ${filePath || 'workspace root'}.`);
                    logOutput('ERROR', `Failed to get diff with HEAD for ${filePath || 'workspace root'}: ${err}`);
                });
            break;

        case 'diffWith':
            if (ref1) {
                repo.diffWith(ref1, diffThisFile)
                    .then((diff: string) => {
                        NEURO.client?.sendContext(`Diff with ref "${ref1}" for ${filePath || 'workspace root'}:\n${diff}`);
                    })
                    .catch((err: string) => {
                        NEURO.client?.sendContext(`Failed to get diff with ref "${ref1}" for ${filePath || 'workspace root'}.`);
                        logOutput('ERROR', `Failed to get diff with ref "${ref1}" for ${filePath || 'workspace root'}: ${err}`);
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
                .catch((err: string) => {
                    NEURO.client?.sendContext(`Failed to get diff index with HEAD for ${filePath || 'workspace root'}.`);
                    logOutput('ERROR', `Failed to get diff index with HEAD for ${filePath || 'workspace root'}: ${err}`);
                });
            break;

        case 'diffIndexWith':
            if (ref1) {
                repo.diffIndexWith(ref1, diffThisFile)
                    .then((diff: string) => {
                        NEURO.client?.sendContext(`Diff index with ref "${ref1}" for ${filePath || 'workspace root'}:\n${diff}`);
                    })
                    .catch((err: string) => {
                        NEURO.client?.sendContext(`Failed to get diff index with ref "${ref1}" for ${filePath || 'workspace root'}.`);
                        logOutput('ERROR', `Failed to get diff index with ref "${ref1}" for ${filePath || 'workspace root'}: ${err}`);
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
                    .catch((err: string) => {
                        NEURO.client?.sendContext(`Failed to get diff between refs "${ref1}" and "${ref2}" for ${filePath || 'workspace root'}.`);
                        logOutput('ERROR', `Failed to get diff between refs "${ref1}" and "${ref2}" for ${filePath || 'workspace root'}: ${err}`);
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
                .catch((err: string) => {
                    NEURO.client?.sendContext('Failed to get full diff for workspace root.');
                    logOutput('ERROR', `Failed to get full diff for workspace root: ${err}`);
                });
            break;

        default:
            NEURO.client?.sendContext(`Invalid diffType "${diffType}".`);
    }

    return;
}

export function handleGitLog(_actionData: ActionData): string | undefined {
    assert(repo);

    repo.log().then((commits: Commit[]) => {
        NEURO.client?.sendContext(`Commit log: ${JSON.stringify(commits)}`);
    }, (err: string) => {
        NEURO.client?.sendContext('Failed to get git log.');
        logOutput('ERROR', `Failed to get git log: ${err}`);
    });

    return;
}

export function handleGitBlame(actionData: ActionData): string | undefined {
    assert(repo);

    const filePath: string = actionData.params.filePath;

    // Normalize the file path if provided; otherwise, use wildcard.
    const stageFiles: string = filePath ? getNormalizedRepoPathForGit(filePath) : '*';

    // Compute an absolute path. If the stageFiles is already absolute, use it.
    // Otherwise, join it with the repository's root path.
    let absolutePath: string;
    if (path.isAbsolute(stageFiles)) {
        absolutePath = stageFiles;
    } else {
        absolutePath = path.join(repo.rootUri.fsPath, stageFiles);
    }

    repo.blame(absolutePath).then((blame: string) => {
        NEURO.client?.sendContext(`Blame attribution: ${blame}`);
    }, (err: string) => {
        NEURO.client?.sendContext('Failed to get blame attribution.');
        logOutput('ERROR', `Error getting blame attribs: ${err}`);
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
    }, (err: string) => {
        NEURO.client?.sendContext('There was an error during tagging.');
        logOutput('ERROR', `Error trying to tag: ${err}`);
    });

    return;
}

export function handleDeleteTag(actionData: ActionData): string | undefined {
    assert(repo);
    const name: string = actionData.params.name;

    repo.deleteTag(name).then(() => {
        NEURO.client?.sendContext(`Deleted tag ${name}`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Couldn't delete tag "${name}"`);
        logOutput('ERROR', `Failed to delete tag ${name}: ${err}`);
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
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to fetch commits from remote "${remoteName}"`);
        logOutput('ERROR', `Failed to fetch commits: ${err}`);
    });

    return;
}

export function handlePullGitCommits(_actionData: ActionData): string | undefined {
    assert(repo);

    repo.pull().then(() => {
        NEURO.client?.sendContext('Pulled commits from remote.');
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to pull commits from remote: ${err}`);
        logOutput('ERROR', `Failed to pull commits: ${err}`);
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
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to push commits to remote "${remoteName}": ${err}`);
        logOutput('ERROR', `Failed to push commits: ${err}`);
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
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to add remote "${remoteName}"`);
        logOutput('ERROR', `Failed to add remote: ${err}`);
    });

    return;
}

export function handleRemoveGitRemote(actionData: ActionData): string | undefined {
    assert(repo);
    const remoteName: string = actionData.params.remoteName;

    repo.removeRemote(remoteName).then(() => {
        NEURO.client?.sendContext(`Removed remote "${remoteName}".`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to remove remote "${remoteName}"`);
        logOutput('ERROR', `Failed to remove remote: ${err}`);
    });

    return;
}

export function handleRenameGitRemote(actionData: ActionData): string | undefined {
    assert(repo);
    const oldRemoteName: string = actionData.params.oldRemoteName;
    const newRemoteName: string = actionData.params.newRemoteName;

    repo.renameRemote(oldRemoteName, newRemoteName).then(() => {
        NEURO.client?.sendContext(`Renamed remote "${oldRemoteName}" to "${newRemoteName}".`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to rename remote "${oldRemoteName}" to "${newRemoteName}"`);
        logOutput('ERROR', `Failed to rename remote ${oldRemoteName}: ${err}`);
    });

    return;
}
