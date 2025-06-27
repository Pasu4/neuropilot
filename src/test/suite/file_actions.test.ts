import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fileActions from '../../file_actions';
import rewire from 'rewire';
import { assertProperties, checkNoErrorWithTimeout, createTestDirectory, createTestFile } from '../test_utils';
import { ActionData, ActionValidationResult } from '../../neuro_client_helper';
import { NeuroClient } from 'neuro-game-sdk';
import { NEURO } from '../../constants';
import { anything, capture, instance, mock, verify } from 'ts-mockito';

const rewireFileActions = rewire('../../file_actions');

suite('File Actions', () => {
    let originalClient: NeuroClient | null = null;
    let mockedClient: NeuroClient;

    setup(async function() {
        // Mock the NeuroClient to avoid actual network calls
        originalClient = NEURO.client;
        mockedClient = mock(NeuroClient);
        NEURO.client = instance(mockedClient);

        // Close all open editors
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    teardown(async function() {
        // Delete all test files created during the tests
        const testFilesDir = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'test_files');
        await vscode.workspace.fs.delete(testFilesDir, { recursive: true, useTrash: false });

        // Restore the original NeuroClient
        NEURO.client = originalClient;
        originalClient = null;
    });

    test('validatePath', async function() {
        const validatePath: (path: string, shouldExist: boolean, pathType: string) => Promise<ActionValidationResult>
            = rewireFileActions.__get__('validatePath');

        // === Arrange ===
        const existingFileUri = await createTestFile('validFile.js');
        const unsafeFileUri = await createTestFile('.unsafeFile.js'); // Neuro-unsafe because it starts with a dot
        const existingFilePath = vscode.workspace.asRelativePath(existingFileUri, false);
        const unsafeFilePath = vscode.workspace.asRelativePath(unsafeFileUri, false);
        const nonexistentPath = 'nonexistent/file.js';

        // === Act & Assert ===
        assertProperties(await validatePath('', true, 'file'), { success: false, retry: true }, 'Empty path should be invalid');

        assertProperties(await validatePath(existingFilePath, true, 'file'), { success: true }, 'Existing path should be valid if shouldExist is true');
        assertProperties(await validatePath(existingFilePath, false, 'file'), { success: false, retry: false }, 'Existing path should not be valid if shouldExist is false');
        assertProperties(await validatePath(unsafeFilePath, true, 'file'), { success: false, retry: false }, 'Unsafe path should be invalid if shouldExist is true');
        assertProperties(await validatePath(unsafeFilePath, false, 'file'), { success: false, retry: false }, 'Unsafe path should not be valid if shouldExist is false');
        assertProperties(await validatePath(nonexistentPath, true, 'file'), { success: false, retry: false }, 'Nonexistent path should be invalid if shouldExist is true');
        assertProperties(await validatePath(nonexistentPath, false, 'file'), { success: true }, 'Nonexistent path should be valid if shouldExist is false');
    });

    test('neuroSafeRenameValidation', async function() {
        const neuroSafeRenameValidation: (actionData: ActionData) => Promise<ActionValidationResult>
            = rewireFileActions.__get__('neuroSafeRenameValidation');

        // === Arrange ===
        const fileUri1 = await createTestFile('file1.js');
        const fileUri2 = await createTestFile('file2.js');
        const unsafeUri = await createTestFile('.unsafe/file.js'); // Neuro-unsafe because it starts with a dot
        const filePath1 = vscode.workspace.asRelativePath(fileUri1, false);
        const filePath2 = vscode.workspace.asRelativePath(fileUri2, false);
        const unsafePath = vscode.workspace.asRelativePath(unsafeUri, false);
        const nonexistentPath = 'nonexistent/file.js';
        const nonexistentPath2 = 'nonexistent/file2.js';
        const unsafeNonexistentPath = '.unsafe/nonexistent/file.js';

        // === Act & Assert ===

        assertProperties(await neuroSafeRenameValidation({
            id: 'abc',
            name: 'rename_file_or_folder',
            params: {
                oldPath: filePath1,
                newPath: nonexistentPath,
            },
        }), { success: true }, 'Rename should succeed if there is no file with the new name');

        assertProperties(await neuroSafeRenameValidation({
            id: 'abc',
            name: 'rename_file_or_folder',
            params: {
                oldPath: filePath1,
                newPath: filePath2,
            },
        }), { success: false, retry: false }, 'Rename should fail if a file with the new name already exists');

        assertProperties(await neuroSafeRenameValidation({
            id: 'abc',
            name: 'rename_file_or_folder',
            params: {
                oldPath: filePath1,
                newPath: unsafeNonexistentPath,
            },
        }), { success: false, retry: false }, 'Rename should fail if the new path is unsafe');

        assertProperties(await neuroSafeRenameValidation({
            id: 'abc',
            name: 'rename_file_or_folder',
            params: {
                oldPath: unsafePath,
                newPath: nonexistentPath,
            },
        }), { success: false, retry: false }, 'Rename should fail if the old path is unsafe');

        assertProperties(await neuroSafeRenameValidation({
            id: 'abc',
            name: 'rename_file_or_folder',
            params: {
                oldPath: nonexistentPath,
                newPath: nonexistentPath2,
            },
        }), { success: false, retry: false }, 'Rename should fail if the old path does not exist');

        assertProperties(await neuroSafeRenameValidation({
            id: 'abc',
            name: 'rename_file_or_folder',
            params: {
                oldPath: filePath1,
                newPath: filePath1,
            },
        }), { success: false, retry: false }, 'Rename should fail if the old and new paths are the same');
    });

    test('neuroSafeDeleteValidation', async function() {
        const neuroSafeDeleteValidation: (actionData: ActionData) => Promise<ActionValidationResult>
            = rewireFileActions.__get__('neuroSafeDeleteValidation');

        // === Arrange ===
        const fileUri = await createTestFile('fileToDelete.js');
        const unsafeUri = await createTestFile('.unsafe/file.js'); // Neuro-unsafe because it starts with a dot
        const dirUri = await createTestDirectory('dirToDelete');
        const filePath = vscode.workspace.asRelativePath(fileUri, false);
        const dirPath = vscode.workspace.asRelativePath(dirUri, false);
        const unsafePath = vscode.workspace.asRelativePath(unsafeUri, false);
        const nonexistentFilePath = 'nonexistent/file.js';
        const nonexistentDirPath = 'nonexistent/dir';

        // === Act & Assert ===
        assertProperties(await neuroSafeDeleteValidation({
            id: 'abc',
            name: 'delete_file_or_folder',
            params: {
                path: filePath,
                recursive: false,
            },
        }), { success: true }, 'Non-recursive delete should succeed for an existing file');

        assertProperties(await neuroSafeDeleteValidation({
            id: 'abc',
            name: 'delete_file_or_folder',
            params: {
                path: filePath,
                recursive: true,
            },
        }), { success: false, retry: false }, 'Recursive delete should fail for an existing file');

        assertProperties(await neuroSafeDeleteValidation({
            id: 'abc',
            name: 'delete_file_or_folder',
            params: {
                path: dirPath,
                recursive: false,
            },
        }), { success: false, retry: false }, 'Non-recursive delete should fail for an existing directory');

        assertProperties(await neuroSafeDeleteValidation({
            id: 'abc',
            name: 'delete_file_or_folder',
            params: {
                path: dirPath,
                recursive: true,
            },
        }), { success: true }, 'Recursive delete should succeed for an existing directory');

        assertProperties(await neuroSafeDeleteValidation({
            id: 'abc',
            name: 'delete_file_or_folder',
            params: {
                path: unsafePath,
                recursive: false,
            },
        }), { success: false, retry: false }, 'Delete should fail for an unsafe file');

        assertProperties(await neuroSafeDeleteValidation({
            id: 'abc',
            name: 'delete_file_or_folder',
            params: {
                path: nonexistentFilePath,
                recursive: false,
            },
        }), { success: false, retry: false }, 'Non-recursive delete should fail for a nonexistent file');

        assertProperties(await neuroSafeDeleteValidation({
            id: 'abc',
            name: 'delete_file_or_folder',
            params: {
                path: nonexistentDirPath,
                recursive: true,
            },
        }), { success: false, retry: false }, 'Recursive delete should fail for a nonexistent directory');
    });

    test('handleGetFiles', async function() {
        // === Arrange ===
        const fileUri1 = await createTestFile('file1.js');
        const fileUri2 = await createTestFile('sub/file2.js');
        const unsafeFileUri = await createTestFile('.unsafe/file.js'); // Neuro-unsafe because it starts with a dot
        const emptyDirUri = await createTestDirectory('testDir');
        const filePath1 = vscode.workspace.asRelativePath(fileUri1, false);
        const filePath2 = vscode.workspace.asRelativePath(fileUri2, false);
        const unsafeFilePath = vscode.workspace.asRelativePath(unsafeFileUri, false);
        const emptyDirPath = vscode.workspace.asRelativePath(emptyDirUri, false);

        // === Act ===

        fileActions.handleGetFiles({ id: 'abc', name: 'get_files' });
        // NEURO.client!.sendContext('test');

        // Wait for context to be sent
        await checkNoErrorWithTimeout(() => { verify(mockedClient.sendContext(anything())).once(); });

        const [context] = capture(mockedClient.sendContext).last();
        const lines = context.split(/\r?\n/);
        lines.shift(); // Remove header line
        lines.shift(); // Remove empty line

        // === Assert ===
        assert.strictEqual(lines.includes(filePath1), true, 'File file1.js should be in the list of files');
        assert.strictEqual(lines.includes(filePath2), true, 'File sub/file2.js should be in the list of files');
        assert.strictEqual(lines.includes(unsafeFilePath), false, 'Unsafe file .unsafe/file.js should not be in the list of files');
        assert.strictEqual(lines.includes(emptyDirPath), false, 'Empty directory testDir should not be in the list of files');
    });

    test('handleOpenFile', async function() {
        // === Arrange ===
        const fileContent = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n68043cf7-01af-43cb-a9ac-6feeec7cdcc1\n';
        const fileUri = await createTestFile('file.js', fileContent);
        const filePath = vscode.workspace.asRelativePath(fileUri, false);

        // === Act ===
        fileActions.handleOpenFile({ id: 'abc', name: 'open_file', params: { filePath: filePath } });
        await checkNoErrorWithTimeout(() => { verify(mockedClient.sendContext(anything())).once(); });
        const [context] = capture(mockedClient.sendContext).last();

        // === Assert ===
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.path.toLowerCase(), fileUri.path.toLowerCase(), 'The correct file should be opened in the active editor');
        assert.strictEqual(context.includes(fileContent), true, 'The file content should be sent in the context');
    });

    test('handleCreateFile', async function() {
        // === Arrange ===
        const relativePath = 'test_files/newFile.js';
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, relativePath);

        // === Act ===
        fileActions.handleCreateFile({ id: 'abc', name: 'create_file', params: { filePath: relativePath } });
        await checkNoErrorWithTimeout(() => { verify(mockedClient.sendContext(anything())).twice(); });

        // === Assert ===
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.path.toLowerCase(), uri.path.toLowerCase(), 'The new file should be opened in the active editor');

        const stat = await vscode.workspace.fs.stat(uri);
        assert.strictEqual(stat.type, vscode.FileType.File, 'The new file should be created successfully');
    });

    test('handleCreateFolder', async function() {
        // === Arrange ===
        const relativePath = 'test_files/newFolder';
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, relativePath);

        // === Act ===
        fileActions.handleCreateFolder({ id: 'abc', name: 'create_folder', params: { folderPath: relativePath } });
        await checkNoErrorWithTimeout(() => { verify(mockedClient.sendContext(anything())).once(); });

        // === Assert ===
        const stat = await vscode.workspace.fs.stat(uri);
        assert.strictEqual(stat.type, vscode.FileType.Directory, 'The new folder should be created successfully');
    });

    test('handleRenameFileOrFolder: Rename closed file', async function() {
        // === Arrange ===
        const fileUri = await createTestFile('fileToRename.js');
        const filePath = vscode.workspace.asRelativePath(fileUri, false);
        const newFilePath = 'test_files/renamedFile.js';
        const newFileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, newFilePath);

        // === Act ===
        fileActions.handleRenameFileOrFolder({ id: 'abc', name: 'rename_file_or_folder', params: { oldPath: filePath, newPath: newFilePath } });
        await checkNoErrorWithTimeout(() => { verify(mockedClient.sendContext(anything())).once(); });

        // === Assert ===
        assert.strictEqual(vscode.window.visibleTextEditors.some(editor => editor.document.uri.path.toLowerCase() === newFileUri.path.toLowerCase()), false, 'Renaming a file should not open the renamed file in the editor');

        const stat = await vscode.workspace.fs.stat(newFileUri);
        assert.strictEqual(stat.type, vscode.FileType.File, 'The file should exist at the new path');

        try {
            await vscode.workspace.fs.stat(fileUri);
            assert.fail(`File ${filePath} should not exist after renaming, but it does.`);
        } catch (erm) {
            if (erm instanceof assert.AssertionError) throw erm;
            // Expected error, file should not exist
        }
    });

    test('handleRenameFileOrFolder: Rename open file', async function() {
        // === Arrange ===
        const fileUri = await createTestFile('fileToRename.js');
        const filePath = vscode.workspace.asRelativePath(fileUri, false);
        const newFilePath = 'test_files/renamedFile.js';
        const newFileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, newFilePath);
        const otherFileUri = await createTestFile('otherFile.js');

        // === Act ===
        await vscode.window.showTextDocument(fileUri, { preview: false });
        await vscode.window.showTextDocument(otherFileUri, { preview: false });

        fileActions.handleRenameFileOrFolder({ id: 'abc', name: 'rename_file_or_folder', params: { oldPath: filePath, newPath: newFilePath } });
        await checkNoErrorWithTimeout(() => { verify(mockedClient.sendContext(anything())).once(); });

        const uris = vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => {
            if (tab.input instanceof vscode.TabInputText) {
                return tab.input.uri;
            }
            assert.fail(`Tab input is not a Text Document: ${tab.input}`);
        }));

        // === Assert ===
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.path.toLowerCase(), otherFileUri.path.toLowerCase(), 'The other file should still be active');
        assert.strictEqual(uris.some(uri => uri.path.toLowerCase() === newFileUri.path.toLowerCase()), true, 'The renamed file should be open');
        assert.strictEqual(uris.some(uri => uri.path.toLowerCase() === fileUri.path.toLowerCase()), false, 'The old file should not be open');
    });

    test('handleRenameFileOrFolder: Rename folder with open file', async function() {
        // === Arrange ===
        const folderUri = await createTestDirectory('folderToRename');
        const fileUri = await createTestFile('folderToRename/file.js');
        const folderPath = vscode.workspace.asRelativePath(folderUri, false);
        const newFolderPath = 'test_files/renamedFolder';
        const newFilePath = 'test_files/renamedFolder/file.js';
        const newFolderUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, newFolderPath);
        const newFileUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, newFilePath);

        // === Act ===
        await vscode.window.showTextDocument(fileUri, { preview: false });

        fileActions.handleRenameFileOrFolder({ id: 'abc', name: 'rename_file_or_folder', params: { oldPath: folderPath, newPath: newFolderPath } });
        await checkNoErrorWithTimeout(() => { verify(mockedClient.sendContext(anything())).once(); });

        // Wait for the editor to update
        await new Promise(resolve => setTimeout(resolve, 100));

        const uris = vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => {
            if (tab.input instanceof vscode.TabInputText) {
                return tab.input.uri;
            }
            assert.fail(`Tab input is not a Text Document: ${tab.input}`);
        }));

        // === Assert ===
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.path.toLowerCase(), newFileUri.path.toLowerCase(), 'The renamed file should be open');
        assert.strictEqual(uris.some(uri => uri.path === fileUri.path), false, 'The old file should not be visible in the editor');

        const stat = await vscode.workspace.fs.stat(newFolderUri);
        assert.strictEqual(stat.type, vscode.FileType.Directory, 'The folder should exist at the new path');
    });

    test('handleDeleteFileOrFolder: Delete open file', async function() {
        // === Arrange ===
        const fileUri = await createTestFile('fileToDelete.js');
        const filePath = vscode.workspace.asRelativePath(fileUri, false);

        // === Act ===
        vscode.window.showTextDocument(fileUri, { preview: false });

        fileActions.handleDeleteFileOrFolder({ id: 'abc', name: 'delete_file_or_folder', params: { path: filePath, recursive: false } });
        await checkNoErrorWithTimeout(() => { verify(mockedClient.sendContext(anything())).once(); });

        // === Assert ===
        try {
            await vscode.workspace.fs.stat(fileUri);
            assert.fail(`File ${filePath} should not exist after deletion, but it does.`);
        } catch (erm) {
            if (erm instanceof assert.AssertionError) throw erm;
            // Expected error, file should not exist
        }

        assert.strictEqual(vscode.window.visibleTextEditors.some(editor => editor.document.uri.path === fileUri.path), false, 'The deleted file should not be visible in the editor');
    });

    test('handleDeleteFileOrFolder: Delete folder', async function() {
        // === Arrange ===
        const folderUri = await createTestDirectory('folderToDelete');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const fileUri = await createTestFile('folderToDelete/file.js');
        const folderPath = vscode.workspace.asRelativePath(folderUri, false);

        // === Act ===
        // If the file is open, it can't be deleted without admin privileges.
        // This only happens in the test environment for some reason.
        // await vscode.window.showTextDocument(fileUri, { preview: false });

        fileActions.handleDeleteFileOrFolder({ id: 'abc', name: 'delete_file_or_folder', params: { path: folderPath, recursive: true } });
        await checkNoErrorWithTimeout(() => { verify(mockedClient.sendContext(anything())).once(); });

        // Wait for the editor to update
        await new Promise(resolve => setTimeout(resolve, 100));

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const uris = vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => {
            if (tab.input instanceof vscode.TabInputText) {
                return tab.input.uri;
            }
            assert.fail(`Tab input is not a Text Document: ${tab.input}`);
        }));

        // === Assert ===
        try {
            await vscode.workspace.fs.stat(folderUri);
            assert.fail(`Folder ${folderPath} should not exist after deletion, but it does.`);
        } catch (erm) {
            if (erm instanceof assert.AssertionError) throw erm;
            // Expected error, folder should not exist
        }

        // assert.strictEqual(uris.some(uri => uri.path === fileUri.path), false, 'The deleted file should not be visible in the editor');
    });
});
