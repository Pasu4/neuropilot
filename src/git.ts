import * as vscode from 'vscode';
import * as path from 'path';
import { NEURO } from './constants';
import { GitExtension } from './types/git';
import { getNormalizedRepoPathForGit, logOutput } from './utils';

/* All actions located in here requires neuropilot.permission.gitOperations to be enabled. */

// Get the Git extension
const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports;
const git = gitExtension.getAPI(1);

// Helper function to retrieve and activate the Git API
async function getGitAPI() {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
        vscode.window.showErrorMessage('Git extension not found. Ensure that the Git extension is installed.');
        return null;
    }
    await gitExtension.activate();
    const git = gitExtension.exports.getAPI(1);
    if (!git) {
        vscode.window.showErrorMessage('Unable to access Git API. It might not be available in this version.');
        return null;
    }
    return git;
}

export async function activate(context: vscode.ExtensionContext) {
    const git = await getGitAPI();
    if (!git) {
        return;
    }
    
    console.log('Git API loaded successfully:', git);
    
    // Iterate over repositories, normalizing the path for each.
    for (const repo of git.repositories) {
        const rawPath = repo.rootUri.fsPath;
        const normalizedPath = getNormalizedRepoPathForGit(rawPath);
    }
}

/**
 * Actions with the Git repo
 * Requires neuropilot.permission.gitConfig to be enabled.
 */

export function handleNewGitRepo(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false) && (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitConfig', false))) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        NEURO.client?.sendActionResult(actionData.id, false, 'No workspace folder is open.');
        return;
    }

    const folderPath = workspaceFolders[0].uri.fsPath;

    NEURO.client?.sendActionResult(actionData.id, true)
    
    git.init(vscode.Uri.file(folderPath)).then(() => {
        NEURO.client?.sendContext(`Initialized a new Git repository in the workspace folder`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to initialize Git repository`);
        logOutput('ERROR', `Failed to initialize Git repository: ${err}`);
    });
}

export function handleGetGitConfig(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false) && (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitConfig', false))) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const configKey: string = actionData.params?.configKey;

    NEURO.client?.sendActionResult(actionData.id, true);

    if (!configKey) {
        repo.getConfigs().then((configs: any) => {
            NEURO.client?.sendContext(`Git config: ${JSON.stringify(configs)}`);
            return;
        });
    }
    else {
        repo.getConfig(configKey).then((configValue: any) => {
            NEURO.client?.sendContext(`Git config key "${configKey}": ${configValue}`);
        }, (err: string) => {
            NEURO.client?.sendContext(`Failed to get Git config key "${configKey}"`);
            logOutput('ERROR', `Failed to get Git config key "${configKey}": ${err}`);
        });
    }
}

export function handleSetGitConfig(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false) && (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitConfig', false))) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const configKey: string = actionData.params?.configKey;
    const configValue: string = actionData.params?.configValue;

    if (!configKey || !configValue) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Config key or value missing.');
        return;
    }
    else {
        NEURO.client?.sendActionResult(actionData.id, true);
        repo.setConfig(configKey, configValue).then(() => {
            NEURO.client?.sendContext(`Set Git config key "${configKey}" to: ${configValue}`);
        }, (err: string) => {
            NEURO.client?.sendContext(`Failed to set Git config key "${configKey}"`);
            logOutput('ERROR', `Failed to set Git config key "${configKey}": ${err}`);
        });
    }
}

/**
 * Actions with Git branches
 */

export function handleNewGitBranch(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const branchName: string = actionData.params?.branchName;
    if (!branchName) {
        NEURO.client?.sendActionResult(actionData.id, false, 'No branch name provided.');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true);
    repo.createBranch(branchName, true).then(() => {
        NEURO.client?.sendContext(`Created and switched to new branch ${branchName}.`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to create branch ${branchName}`);
        logOutput('ERROR', `Failed to create branch: ${err}`);
    });
}

export function handleSwitchGitBranch(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const branchName: string = actionData.params?.branchName;
    if (!branchName) {
        NEURO.client?.sendActionResult(actionData.id, false, 'No branch name provided.');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true);
    repo.checkout(branchName).then(() => {
        NEURO.client?.sendContext(`Switched to branch ${branchName}.`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to switch to branch ${branchName}`);
        logOutput('ERROR', `Failed to switch branch: ${err}`);
    });
}

export function handleDeleteGitBranch(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const branchName: string = actionData.params?.branchName;
    const forceDelete: boolean = actionData.params?.forceDelete || false;
    if (!branchName) {
        NEURO.client?.sendActionResult(actionData.id, false, 'No branch name provided.');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true);
    repo.deleteBranch(branchName, forceDelete).then(() => {
        NEURO.client?.sendContext(`Deleted branch ${branchName}.`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to delete branch${forceDelete === false && "\nEnsure the branch is merged before deleting, or force delete it to discard changes."}`);
        logOutput('ERROR', `Failed to delete branch: ${err}`);
    });
}

/**
 * Actions with the Git index
 */

export function handleGitStatus(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    
    NEURO.client?.sendActionResult(actionData.id, true)
    repo.status().then((status: any) => {
        NEURO.client?.sendContext(`Git status: ${JSON.stringify(status)}`);
    }
    , (err: string) => {
        NEURO.client?.sendContext(`Failed to get Git repository status`);
        logOutput('ERROR', `Failed to get Git status: ${err}`);
    });
}

export function handleGitAdd(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const filePath: string = actionData.params?.filePath;

    NEURO.client?.sendActionResult(actionData.id, true)

    // Normalize the file path if provided; otherwise, use wildcard.
    const stageFiles: string = filePath ? getNormalizedRepoPathForGit(filePath) : `*`;

    // Compute an absolute path. If the stageFiles is already absolute, use it.
    // Otherwise, join it with the repository's root path.
    let absolutePath: string;
    if (path.isAbsolute(stageFiles)) {
        absolutePath = stageFiles;
    } else {
        absolutePath = path.join(repo.rootUri.fsPath, stageFiles);
    }

    // Pass the absolute path to the Git add command.
    repo.add([absolutePath]).then(() => {
        NEURO.client?.sendContext(`Added ${stageFiles} to staging area.`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Adding files to staging area failed`);
        logOutput("ERROR", `Failed to git add: ${err}`)
    });
}

export function handleGitRevert(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const filePath: string = actionData.params?.filePath;

    NEURO.client?.sendActionResult(actionData.id, true)

    // Normalize the file path if provided; otherwise, use wildcard.
    const revertFiles: string = filePath ? getNormalizedRepoPathForGit(filePath) : `*`;

    // Compute an absolute path. If the removeFiles is already absolute, use it.
    // Otherwise, join it with the repository's root path.
    let absolutePath: string;
    if (path.isAbsolute(revertFiles)) {
        absolutePath = revertFiles;
    } else {
        absolutePath = path.join(repo.rootUri.fsPath, revertFiles);
    }

    // Pass the absolute path to the Git remove command.
    repo.revert([absolutePath]).then(() => {
        NEURO.client?.sendContext(`Removed ${revertFiles} from the index.`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Reverting files failed`);
        logOutput("ERROR", `Git revert failed: ${err}`)
    });
}

export function handleGitCommit(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const message = `Neuro commit: ${actionData.params?.message}`;

    if (!message) {
        NEURO.client?.sendActionResult(actionData.id, false, "No commit message provided.")
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true)

    repo.inputBox.value = message;
    repo.commit(message).then(() => {
        NEURO.client?.sendContext(`Committed with message: "${message}"`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to record commit`);
        logOutput("ERROR", `Failed to commit: ${err}`)
    });
}

export function handleGitDiff(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const ref1: string = actionData.params?.ref1;
    const ref2: string = actionData.params?.ref2;
    const filePath: string = actionData.params?.filePath;
    const diffType: string = actionData.params?.diffType || 'diffWithHEAD'; // Default to diffWithHEAD

    try {
        switch (diffType) {
            case 'diffWithHEAD':
                if (filePath) {
                    repo.diffWithHEAD(filePath).then((diff: string) => {
                        NEURO.client?.sendActionResult(actionData.id, true, `Diff with HEAD for file "${filePath}":\n${diff}`);
                    });
                } else {
                    repo.diffWithHEAD().then((changes: any) => {
                        NEURO.client?.sendActionResult(actionData.id, true, `Diff with HEAD:\n${JSON.stringify(changes)}`);
                    });
                }
                break;

            case 'diffWith':
                if (ref1 && filePath) {
                    repo.diffWith(ref1, filePath).then((diff: string) => {
                        NEURO.client?.sendActionResult(actionData.id, true, `Diff with ref "${ref1}" for file "${filePath}":\n${diff}`);
                    });
                } else if (ref1) {
                    repo.diffWith(ref1).then((changes: any) => {
                        NEURO.client?.sendActionResult(actionData.id, true, `Diff with ref "${ref1}":\n${JSON.stringify(changes)}`);
                    });
                } else {
                    NEURO.client?.sendActionResult(actionData.id, false, 'Ref1 is required for diffWith.');
                }
                break;

            case 'diffIndexWithHEAD':
                if (filePath) {
                    repo.diffIndexWithHEAD(filePath).then((diff: string) => {
                        NEURO.client?.sendActionResult(actionData.id, true, `Diff index with HEAD for file "${filePath}":\n${diff}`);
                    });
                } else {
                    repo.diffIndexWithHEAD().then((changes: any) => {
                        NEURO.client?.sendActionResult(actionData.id, true, `Diff index with HEAD:\n${JSON.stringify(changes)}`);
                    });
                }
                break;

            case 'diffIndexWith':
                if (ref1 && filePath) {
                    repo.diffIndexWith(ref1, filePath).then((diff: string) => {
                        NEURO.client?.sendActionResult(actionData.id, true, `Diff index with ref "${ref1}" for file "${filePath}":\n${diff}`);
                    });
                } else if (ref1) {
                    repo.diffIndexWith(ref1).then((changes: any) => {
                        NEURO.client?.sendActionResult(actionData.id, true, `Diff index with ref "${ref1}":\n${JSON.stringify(changes)}`);
                    });
                } else {
                    NEURO.client?.sendActionResult(actionData.id, false, 'Ref1 is required for diffIndexWith.');
                }
                break;

            case 'diffBetween':
                if (ref1 && ref2 && filePath) {
                    repo.diffBetween(ref1, ref2, filePath).then((diff: string) => {
                        NEURO.client?.sendActionResult(actionData.id, true, `Diff between refs "${ref1}" and "${ref2}" for file "${filePath}":\n${diff}`);
                    });
                } else if (ref1 && ref2) {
                    repo.diffBetween(ref1, ref2).then((changes: any) => {
                        NEURO.client?.sendActionResult(actionData.id, true, `Diff between refs "${ref1}" and "${ref2}":\n${JSON.stringify(changes)}`);
                    });
                } else {
                    NEURO.client?.sendActionResult(actionData.id, false, 'Both ref1 and ref2 are required for diffBetween.');
                }
                break;
            
            case 'fullDiff':
                repo.diff().then((diff: string) => {
                    NEURO.client?.sendActionResult(actionData.id, true, `Full diff:\n${diff}`);
                });
                break;
            
            default:
                NEURO.client?.sendActionResult(actionData.id, false, `Invalid diffType "${diffType}".`);
        }
    } catch (err) {
        NEURO.client?.sendActionResult(actionData.id, true);
        NEURO.client?.sendContext("Failed to get diffs between files")
        logOutput("ERROR", `Failed to diff files: ${err}`)
    }
}

/**
 * Actions with Git remotes
 * Requires neuropilot.permission.gitRemotes to be enabled.
 */

export function handleFetchGitCommits(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false) && !vscode.workspace.getConfiguration('neuropilot').get('permission.gitRemotes')) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const remoteName: string = actionData.params?.remoteName;
    const branchName: string = actionData.params?.branchName;

    NEURO.client?.sendActionResult(actionData.id, true)

    repo.fetch(remoteName, branchName).then(() => {
        NEURO.client?.sendContext(`Fetched commits from remote "${remoteName}"${branchName && `, branch "${branchName}"`}.`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to fetch commits from remote "${remoteName}"`);
        logOutput("ERROR", `Failed to fetch commits: ${err}`)
    });
}

export function handlePullGitCommits(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false) && !vscode.workspace.getConfiguration('neuropilot').get('permission.gitRemotes')) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];

    NEURO.client?.sendActionResult(actionData.id, true)

    repo.pull().then(() => {
        NEURO.client?.sendContext(`Pulled commits from remote.`);
    }
    , (err: string) => {
        NEURO.client?.sendContext(`Failed to pull commits from remote`);
        logOutput("ERROR", `Failed to pull commits: ${err}`)
    });
}

export function handlePushGitCommits(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false) && !vscode.workspace.getConfiguration('neuropilot').get('permission.gitRemotes')) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const remoteName: string = actionData.params?.remoteName;
    const branchName: string = actionData.params?.branchName;
    const forcePush: boolean = actionData.params?.forcePush || false;

    NEURO.client?.sendActionResult(actionData.id, true)

    repo.push(remoteName, branchName, forcePush).then(() => {
        NEURO.client?.sendContext(`Pushed commits${remoteName && ` to remote "${remoteName}"`}${branchName && `, branch "${branchName}"`}.${forcePush === true && " (forced push)"}`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to push commits to remote "${remoteName}"`);
        logOutput("ERROR", `Failed to push commits: ${err}`)
    });
}

/**
 * THESE ACTIONS ARE CONSIDERED DANGEROUS REMOTE OPERATIONS
 * Requires neuropilot.permission.editRemoteData to be enabled, IN ADDITION to neuropilot.permission.gitRemotes.
 */

export function handleAddGitRemote(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false) && (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitRemotes', false) && (!vscode.workspace.getConfiguration('neuropilot').get('permission.editRemoteData', false)))) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const remoteName: string = actionData.params?.remoteName;
    const remoteUrl: string = actionData.params?.remoteUrl;

    if (!remoteName || !remoteUrl) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Remote name or URL missing.');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true)

    repo.addRemote(remoteName, remoteUrl).then(() => {
        NEURO.client?.sendContext(`Added remote "${remoteName}" with URL: ${remoteUrl}`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to add remote "${remoteName}"`);
        logOutput("ERROR", `Failed to add remote: ${err}`)
    });
}

export function handleRemoveGitRemote(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false) && (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitRemotes', false) && (!vscode.workspace.getConfiguration('neuropilot').get('permission.editRemoteData', false)))) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const remoteName: string = actionData.params?.remoteName;

    if (!remoteName) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Remote name missing.');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true)

    repo.removeRemote(remoteName).then(() => {
        NEURO.client?.sendContext(`Removed remote "${remoteName}".`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to remove remote "${remoteName}"`);
        logOutput("ERROR", `Failed to remove remote: ${err}`)
    });
}

export function handleRenameGitRemote(actionData: any) {
    if (!git) {
        NEURO.client?.sendActionResult(actionData.id, true, 'Git extension not available.');
        return;
    }
    if (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitOperations', false) && (!vscode.workspace.getConfiguration('neuropilot').get('permission.gitRemotes', false) && (!vscode.workspace.getConfiguration('neuropilot').get('permission.editRemoteData', false)))) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to perform Git operations.');
        return;
    }

    const repo = git.repositories[0];
    const oldRemoteName: string = actionData.params?.oldRemoteName;
    const newRemoteName: string = actionData.params?.newRemoteName;

    if (!oldRemoteName || !newRemoteName) {
        NEURO.client?.sendActionResult(actionData.id, false, "Both oldRemoteName and newRemoteName are required")
    }

    NEURO.client?.sendActionResult(actionData.id, true)
    
    repo.renameRemote(oldRemoteName, newRemoteName).then(() => {
        NEURO.client?.sendContext(`Renamed remote "${oldRemoteName}" to "${newRemoteName}".`);
    }, (err: string) => {
        NEURO.client?.sendContext(`Failed to rename remote "${oldRemoteName}" to "${newRemoteName}"`);
        logOutput("ERROR", `Failed to rename remote ${oldRemoteName}: ${err}`)
    });
}