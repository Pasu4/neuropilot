import * as vscode from 'vscode';

import { NEURO } from "./constants";
import { combineGlobLines, formatActionID, getPositionContext, getWorkspacePath, isPathNeuroSafe, logOutput, normalizePath } from './utils';

export function handleCreateFile(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.create', false)) {
        logOutput('WARNING', 'Neuro attempted to create a file, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have file creation permissions.');
        return;
    }

    const relativePathParam = actionData.params?.filePath;
    if(relativePathParam === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "filePath"');
        return;
    }

    const relativePath = normalizePath(relativePathParam).replace(/^\//, '');
    const absolutePath = getWorkspacePath() + '/' + relativePath;
    if(!isPathNeuroSafe(absolutePath)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to create a file at this location');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true);

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
        } catch { } // File does not exist, continue

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
        if(!vscode.workspace.getConfiguration('neuropilot').get('permission.openFiles', false))
            return;

        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document);
            const cursor = editor.selection.active;
            NEURO.client?.sendContext(`Opened file ${relativePath}\n\nContent:\n\n\`\`\`${document.languageId}\n${document.getText()}\n\`\`\`\n\nCursor at (${cursor.line}:${cursor.character})`);
        } catch {
            logOutput('ERROR', `Failed to open file ${relativePath}`);
            NEURO.client?.sendContext(`Failed to open file ${relativePath}`);
        }
    }
    // vscode.workspace.fs.stat(vscode.Uri.file(getWorkspacePath() + '/' + normalizePath(filePath))).then(
    //     (_) => {
    //         NEURO.client?.sendContext(`Could not create file: File ${filePath} already exists`);
    //     },
    //     (_erm) => {
    //         vscode.workspace.fs.writeFile(vscode.Uri.file(normalizedPath), new Uint8Array(0)).then(
    //             (_) => {
    //                 logOutput('INFO', `Created file ${filePath}`);
    //                 NEURO.client?.sendContext(`Created file ${filePath}`);

    //                 if(vscode.workspace.getConfiguration('neuropilot').get('permission.openFiles', false)) {
    //                     vscode.workspace.openTextDocument(vscode.Uri.file(getWorkspacePath() + '/' + normalizePath(filePath))).then(
    //                         (document) => {
    //                             vscode.window.showTextDocument(document).then((_) => {
    //                                 logOutput('INFO', `Opened file ${filePath}`);
    //                                 const cursor = vscode.window.activeTextEditor!.selection
    //                                 NEURO.client?.sendContext(`Opened file ${filePath}\n\nContent:\n\n\`\`\`${document.languageId}\n${document.getText()}\n\`\`\``);
    //                             })
    //                         }
    //                     );
    //                 }
    //             },
    //             (_erm) => {
    //                 logOutput('ERROR', `Failed to create file ${filePath}`);
    //                 NEURO.client?.sendContext(`Failed to create file ${filePath}`);
    //             }
    //         );
    //     }
    // );
}

export function handleCreateFolder(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.create', false)) {
        logOutput('WARNING', 'Neuro attempted to create a folder, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have folder creation permissions.');
        return;
    }

    const relativePathParam = actionData.params?.folderPath;
    if(relativePathParam === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "folderPath"');
        return;
    }

    const relativePath = normalizePath(relativePathParam).replace(/^\/|\/$/g, '');
    const absolutePath = getWorkspacePath() + '/' + relativePath;
    if(!isPathNeuroSafe(absolutePath)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to create a folder at this location');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true);
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
        } catch { } // Folder does not exist, continue

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

export function handleRenameFileOrFolder(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.rename', false)) {
        logOutput('WARNING', 'Neuro attempted to rename a file or folder, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have rename permissions.');
        return;
    }

    const oldRelativePathParam = actionData.params?.oldPath;
    const newRelativePathParam = actionData.params?.newPath;
    if(oldRelativePathParam === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "oldPath"');
        return;
    }
    if(newRelativePathParam === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "newPath"');
        return;
    }

    const oldRelativePath = normalizePath(oldRelativePathParam).replace(/^\/|\/$/g, '');
    const newRelativePath = normalizePath(newRelativePathParam).replace(/^\/|\/$/g, '');
    const oldAbsolutePath = getWorkspacePath() + '/' + oldRelativePath;
    const newAbsolutePath = getWorkspacePath() + '/' + newRelativePath;
    if(!isPathNeuroSafe(oldAbsolutePath)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to rename this element');
        return;
    }
    if(!isPathNeuroSafe(newAbsolutePath)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to rename the element to this name');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true);

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
        } catch { } // New path does not exist, continue

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

export function handleDeleteFileOrFolder(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.delete', false)) {
        logOutput('WARNING', 'Neuro attempted to delete a file or folder, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have delete permissions.');
        return;
    }

    const relativePathParam = actionData.params?.pathToDelete;
    const recursive = actionData.params?.recursive ?? false;
    if(relativePathParam === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "pathToDelete"');
        return;
    }

    const relativePath = normalizePath(relativePathParam).replace(/^\/|\/$/g, '');
    const absolutePath = getWorkspacePath() + '/' + relativePath;
    if(!isPathNeuroSafe(absolutePath)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to delete this element');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true);

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
        if(stat.type === vscode.FileType.Directory && !recursive) {
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

export function handleGetFiles(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.openFiles', false)) {
        logOutput('WARNING', 'Neuro attempted to get files, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have file open permissions.');
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if(workspaceFolder === undefined) {
        NEURO.client?.sendActionResult(actionData.id, true, 'No workspace open to get files from');
        return;
    }
    NEURO.client?.sendActionResult(actionData.id, true);

    const includePattern = combineGlobLines(vscode.workspace.getConfiguration('neuropilot').get('includePattern', '**'));
    const excludePattern = combineGlobLines(vscode.workspace.getConfiguration('neuropilot').get('excludePattern', ''));
    vscode.workspace.findFiles(includePattern, excludePattern).then(
        (uris) => {
            const paths = uris
                .filter(uri => isPathNeuroSafe(uri.fsPath, false))
                .map(uri => vscode.workspace.asRelativePath(uri))
                .sort((a, b) => {
                    const aParts = a.split('/');
                    const bParts = b.split('/');

                    for(let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
                        if(aParts[i] !== bParts[i]) {
                            if(aParts.length === i + 1) return -1;
                            if(bParts.length === i + 1) return 1;
                            return aParts[i].localeCompare(bParts[i]);
                        }
                    }
                    return aParts.length - bParts.length;
                });
            logOutput('INFO', `Sending list of files in workspace to Neuro`);
            NEURO.client?.sendContext(`Files in workspace:\n\n${paths.join('\n')}`);
        }
    )
}

export function handleOpenFile(actionData: any) {
    if(!vscode.workspace.getConfiguration('neuropilot').get('permission.openFiles', false)) {
        logOutput('WARNING', 'Neuro attempted to open a file, but permission is disabled');
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have file open permissions.');
        return;
    }

    const relativePath = actionData.params?.path;
    if(relativePath === undefined) {
        NEURO.client?.sendActionResult(actionData.id, false, 'Missing required parameter "fileName"');
        return;
    }

    const uri = vscode.Uri.file(getWorkspacePath() + '/' + normalizePath(relativePath));
    if(!isPathNeuroSafe(uri.fsPath)) {
        NEURO.client?.sendActionResult(actionData.id, true, 'You do not have permission to access this file');
        return;
    }

    NEURO.client?.sendActionResult(actionData.id, true);

    vscode.workspace.openTextDocument(uri).then(
        (document) => {
            vscode.window.showTextDocument(document);
            logOutput('INFO', `Opened file ${relativePath}`);
            NEURO.client?.sendContext(`Opened file ${relativePath}\n\nContent:\n\n\`\`\`${document.languageId}\n${document.getText()}\n\`\`\``);
        },
        (_) => {
            logOutput('ERROR', `Failed to open file ${relativePath}`);
            NEURO.client?.sendContext(`Failed to open file ${relativePath}`);
        }
    );
}