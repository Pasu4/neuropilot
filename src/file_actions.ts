import * as vscode from 'vscode';

import { NEURO } from './constants';
import { combineGlobLines, filterFileContents, getFence, getVirtualCursor, getWorkspacePath, isPathNeuroSafe, logOutput, normalizePath } from './utils';
import { ActionData, contextNoAccess, RCEAction, actionValidationFailure, actionValidationAccept, ActionValidationResult, stripToActions } from './neuro_client_helper';
import { CONFIG, PERMISSIONS, getPermissionLevel } from './config';

/**
 * The path validator.
 * @param path The relative path to the file/folder.
 * @param checkExist Whether to check if the directory exists or doesn't exist. `true` returns a failure if it does exist, `false` returns a failure if it doesn't.
 * @param directoryType What type of directory it is. 
 * @returns A validation message. {@link actionValidationFailure} if any validation steps fail, {@link actionValidationAccept} otherwise.
 */
async function validatePath(path: string, checkExist: boolean, directoryType: string): Promise<ActionValidationResult> {
    if (path === '') {
        return actionValidationFailure('No file path specified.', true);
    };
    const absolutePath = getWorkspacePath() + '/' + normalizePath(path).replace(/^\/|\/$/g, '');
    if (!isPathNeuroSafe(absolutePath)) {
        return actionValidationFailure(`You are not allowed to access this ${directoryType}.`);
    }

    const existence = await getPathExistence(absolutePath);
    if (checkExist === true && existence === true) {
        return actionValidationFailure(`${directoryType} "${path}" already exists.`);
    } else if (checkExist === false && existence === false) {
        return actionValidationFailure(`${directoryType} "${path}" doesn't exist.`);
    }

    return actionValidationAccept();
};

async function getPathExistence(absolutePath: string): Promise<boolean> {
    const pathAsUri = vscode.Uri.file(absolutePath);
    try {
        await vscode.workspace.fs.stat(pathAsUri);
        return true;
    } catch {
        return false;
    }
}

async function neuroSafeValidation(actionData: ActionData): Promise<ActionValidationResult> {
    let result: ActionValidationResult = actionValidationAccept();
    const checkExists = actionData.name === 'open_file' ? false : true;
    if (actionData.params?.filePath) {
        result = await validatePath(actionData.params.filePath, checkExists, 'file');
    }
    if (!result.success) return result;
    if (actionData.params?.folderPath) {
        result = await validatePath(actionData.params.folderPath, checkExists, 'folder');
    }
    return result;
}

async function neuroSafeDeleteValidation(actionData: ActionData): Promise<ActionValidationResult> {
    const check = validatePath(actionData.params.path, false, actionData.params.recursive ? 'folder' : 'file');
    if (!(await check).success) return check;
    return actionValidationAccept();
}

async function neuroSafeRenameValidation(actionData: ActionData): Promise<ActionValidationResult> {
    let check = validatePath(actionData.params.oldPath, false, 'directory');
    if (!(await check).success) return check;
    check = validatePath(actionData.params.newPath, true, 'directory');
    if (!(await check).success) return check;

    return actionValidationAccept();
}

export const fileActions = {
    get_files: {
        name: 'get_files',
        description: 'Get a list of files in the workspace',
        permissions: [PERMISSIONS.openFiles],
        handler: handleGetFiles,
        validator: [() => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder === undefined)
                return actionValidationFailure('No open workspace to get files from.');
            return actionValidationAccept();
        },
        ],
        promptGenerator: 'get a list of files in the workspace.',
    },
    open_file: {
        name: 'open_file',
        description: 'Open a file in the workspace',
        schema: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
            },
            required: ['filePath'],
        },
        permissions: [PERMISSIONS.openFiles],
        handler: handleOpenFile,
        validator: [neuroSafeValidation],
        promptGenerator: (actionData: ActionData) => `open the file "${actionData.params?.filePath}".`,
    },
    create_file: {
        name: 'create_file',
        description: 'Create a new file at the specified path. The path should include the name of the new file.',
        schema: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
            },
            required: ['filePath'],
        },
        permissions: [PERMISSIONS.create],
        handler: handleCreateFile,
        validator: [neuroSafeValidation],
        promptGenerator: (actionData: ActionData) => `create the file "${actionData.params?.filePath}".`,
    },
    create_folder: {
        name: 'create_folder',
        description: 'Create a new folder at the specified path. The path should include the name of the new folder.',
        schema: {
            type: 'object',
            properties: {
                folderPath: { type: 'string' },
            },
            required: ['folderPath'],
        },
        permissions: [PERMISSIONS.create],
        handler: handleCreateFolder,
        validator: [neuroSafeValidation],
        promptGenerator: (actionData: ActionData) => `create the folder "${actionData.params?.folderPath}".`,
    },
    rename_file_or_folder: {
        name: 'rename_file_or_folder',
        description: 'Rename a file or folder. Specify the full relative path for both the old and new names.',
        schema: {
            type: 'object',
            properties: {
                oldPath: { type: 'string' },
                newPath: { type: 'string' },
            },
            required: ['oldPath', 'newPath'],
        },
        permissions: [PERMISSIONS.rename],
        handler: handleRenameFileOrFolder,
        validator: [neuroSafeRenameValidation],
        promptGenerator: (actionData: ActionData) => `rename "${actionData.params?.oldPath}" to "${actionData.params?.newPath}".`,
    },
    delete_file_or_folder: {
        name: 'delete_file_or_folder',
        description: 'Delete a file or folder. If you want to delete a folder, set the "recursive" parameter to true.',
        schema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                recursive: { type: 'boolean' },
            },
            required: ['path'],
        },
        permissions: [PERMISSIONS.delete],
        handler: handleDeleteFileOrFolder,
        validator: [neuroSafeDeleteValidation],
        promptGenerator: (actionData: ActionData) => `delete "${actionData.params?.pathToDelete}".`,
    },
} satisfies Record<string, RCEAction>;

export function registerFileActions() {
    if (getPermissionLevel(PERMISSIONS.openFiles)) {
        NEURO.client?.registerActions(stripToActions([
            fileActions.get_files,
            fileActions.open_file,
        ]));
    }

    if (getPermissionLevel(PERMISSIONS.create)) {
        NEURO.client?.registerActions(stripToActions([
            fileActions.create_file,
            fileActions.create_folder,
        ]));
    }

    if (getPermissionLevel(PERMISSIONS.rename)) {
        NEURO.client?.registerActions(stripToActions([
            fileActions.rename_file_or_folder,
        ]));
    }

    if (getPermissionLevel(PERMISSIONS.delete)) {
        NEURO.client?.registerActions(stripToActions([
            fileActions.delete_file_or_folder,
        ]));
    }
}

export function handleCreateFile(actionData: ActionData): string | undefined {
    const relativePathParam = actionData.params.filePath;
    const relativePath = normalizePath(relativePathParam).replace(/^\//, '');
    const absolutePath = getWorkspacePath() + '/' + relativePath;
    if (!isPathNeuroSafe(absolutePath))
        return contextNoAccess(absolutePath);

    checkAndOpenFileAsync(absolutePath, relativePath);

    return;

    // Function to avoid pyramid of doom
    async function checkAndOpenFileAsync(absolutePath: string, relativePath: string) {
        const fileUri = vscode.Uri.file(absolutePath);

        // Check if the file already exists
        try {
            await vscode.workspace.fs.stat(fileUri);
            // If no error is thrown, the file already exists
            NEURO.client?.sendContext(`Could not create file: File ${relativePath} already exists`);
            return;
        } catch { /* File does not exist, continue */ }

        // Create the file
        try {
            await vscode.workspace.fs.writeFile(fileUri, new Uint8Array(0));
        } catch {
            logOutput('ERROR', `Failed to create file ${relativePath}`);
            NEURO.client?.sendContext(`Failed to create file ${relativePath}`);
            return;
        }

        logOutput('INFO', `Created file ${relativePath}`);
        NEURO.client?.sendContext(`Created file ${relativePath}`);

        // Open the file if Neuro has permission to do so
        if (!getPermissionLevel(PERMISSIONS.openFiles))
            return;

        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document);
            NEURO.client?.sendContext(`Opened new file ${relativePath}`);
        } catch {
            logOutput('ERROR', `Failed to open new file ${relativePath}`);
            NEURO.client?.sendContext(`Failed to open new file ${relativePath}`);
        }
    }
}

export function handleCreateFolder(actionData: ActionData): string | undefined {
    const relativePathParam = actionData.params.folderPath;
    const relativePath = normalizePath(relativePathParam).replace(/^\/|\/$/g, '');
    const absolutePath = getWorkspacePath() + '/' + relativePath;

    checkAndCreateFolderAsync(absolutePath, relativePath);

    return;

    // Function to avoid pyramid of doom
    async function checkAndCreateFolderAsync(absolutePath: string, relativePath: string) {
        const folderUri = vscode.Uri.file(absolutePath);

        // Check if the folder already exists
        try {
            await vscode.workspace.fs.stat(folderUri);
            // If no error is thrown, the folder already exists
            NEURO.client?.sendContext(`Could not create folder: Folder ${relativePath} already exists`);
            return;
        } catch { /* Folder does not exist, continue */ }

        // Create the folder
        try {
            await vscode.workspace.fs.createDirectory(folderUri);
        } catch {
            logOutput('ERROR', `Failed to create folder ${relativePath}`);
            NEURO.client?.sendContext(`Failed to create folder ${relativePath}`);
            return;
        }

        logOutput('INFO', `Created folder ${relativePath}`);
        NEURO.client?.sendContext(`Created folder ${relativePath}`);
    }
}

export function handleRenameFileOrFolder(actionData: ActionData): string | undefined {
    const oldRelativePathParam = actionData.params.oldPath;
    const newRelativePathParam = actionData.params.newPath;

    const oldRelativePath = normalizePath(oldRelativePathParam).replace(/^\/|\/$/g, '');
    const newRelativePath = normalizePath(newRelativePathParam).replace(/^\/|\/$/g, '');
    const oldAbsolutePath = getWorkspacePath() + '/' + oldRelativePath;
    const newAbsolutePath = getWorkspacePath() + '/' + newRelativePath;

    checkAndRenameAsync(oldAbsolutePath, oldRelativePath, newAbsolutePath, newRelativePath);

    return;

    // Function to avoid pyramid of doom
    async function checkAndRenameAsync(oldAbsolutePath: string, oldRelativePath: string, newAbsolutePath: string, newRelativePath: string) {
        const oldUri = vscode.Uri.file(oldAbsolutePath);
        const newUri = vscode.Uri.file(newAbsolutePath);

        // Check if the new path already exists
        try {
            await vscode.workspace.fs.stat(newUri);
            // If no error is thrown, the new path already exists
            NEURO.client?.sendContext(`Could not rename: ${newRelativePath} already exists`);
            return;
        } catch { /* New path does not exist, continue */ }

        // Rename the file/folder
        try {
            await vscode.workspace.fs.rename(oldUri, newUri);
        } catch {
            logOutput('ERROR', `Failed to rename ${oldRelativePath} to ${newRelativePath}`);
            NEURO.client?.sendContext(`Failed to rename ${oldRelativePath} to ${newRelativePath}`);
            return;
        }

        logOutput('INFO', `Renamed ${oldRelativePath} to ${newRelativePath}`);
        NEURO.client?.sendContext(`Renamed ${oldRelativePath} to ${newRelativePath}`);
    }
}

export function handleDeleteFileOrFolder(actionData: ActionData): string | undefined {
    const relativePathParam = actionData.params.path;
    const recursive = actionData.params.recursive ?? false;

    const relativePath = normalizePath(relativePathParam).replace(/^\/|\/$/g, '');
    const absolutePath = getWorkspacePath() + '/' + relativePath;

    checkAndDeleteAsync(absolutePath, relativePath, recursive);

    return;

    // Function to avoid pyramid of doom
    async function checkAndDeleteAsync(absolutePath: string, relativePath: string, recursive: boolean) {
        const uri = vscode.Uri.file(absolutePath);
        let stat: vscode.FileStat;

        // Check if the path exists
        try {
            stat = await vscode.workspace.fs.stat(uri);
        } catch {
            NEURO.client?.sendContext(`Could not delete: ${relativePath} does not exist`);
            return;
        }

        // Check for correct recursive parameter
        if (stat.type === vscode.FileType.Directory && !recursive) {
            NEURO.client?.sendContext(`Could not delete: ${relativePath} is a directory cannot be deleted without the "recursive" parameter`);
            return;
        }

        // Delete the file/folder
        try {
            await vscode.workspace.fs.delete(uri, { recursive: recursive, useTrash: true });
        } catch {
            logOutput('ERROR', `Failed to delete ${relativePath}`);
            NEURO.client?.sendContext(`Failed to delete ${relativePath}`);
            return;
        }

        logOutput('INFO', `Deleted ${relativePath}`);
        NEURO.client?.sendContext(`Deleted ${relativePath}`);
    }
}

export function handleGetFiles(_actionData: ActionData): string | undefined {
    const includePattern = combineGlobLines(CONFIG.includePattern || '**');
    const excludePattern = combineGlobLines(CONFIG.excludePattern || '');
    vscode.workspace.findFiles(includePattern, excludePattern).then(
        (uris) => {
            const paths = uris
                .filter(uri => isPathNeuroSafe(uri.fsPath, false))
                .map(uri => vscode.workspace.asRelativePath(uri))
                .sort((a, b) => {
                    const aParts = a.split('/');
                    const bParts = b.split('/');

                    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
                        if (aParts[i] !== bParts[i]) {
                            if (aParts.length === i + 1) return -1;
                            if (bParts.length === i + 1) return 1;
                            return aParts[i].localeCompare(bParts[i]);
                        }
                    }
                    return aParts.length - bParts.length;
                });
            logOutput('INFO', 'Sending list of files in workspace to Neuro');
            NEURO.client?.sendContext(`Files in workspace:\n\n${paths.join('\n')}`);
        },
    );

    return undefined;
}

export function handleOpenFile(actionData: ActionData): string | undefined {
    const relativePath = actionData.params.filePath;

    const uri = vscode.Uri.file(getWorkspacePath() + '/' + normalizePath(relativePath));
    if (!isPathNeuroSafe(uri.fsPath))
        return contextNoAccess(uri.fsPath);

    openFileAsync();
    return;

    async function openFileAsync() {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);

            logOutput('INFO', `Opened file ${relativePath}`);
            const cursorOffset = document.offsetAt(getVirtualCursor() ?? new vscode.Position(0, 0));
            let text = document.getText();
            text = text.slice(0, cursorOffset) + '<<<|>>>' + text.slice(cursorOffset);
            const fence = getFence(text);
            NEURO.client?.sendContext(`Opened file ${relativePath}\n\nContent (cursor position denoted by \`<<<|>>>\`):\n\n${fence}${document.languageId}\n${filterFileContents(text)}\n${fence}`);
        }
        catch {
            logOutput('ERROR', `Failed to open file ${relativePath}`);
            NEURO.client?.sendContext(`Failed to open file ${relativePath}`);
        }
    }
}
