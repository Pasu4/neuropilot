import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Tests', () => {
    test('Sanity Check', () => {
        assert.strictEqual(1 + 1, 2, '1 + 1 should equal 2');
    });

    test('Extension exists', async () => {
        const extension = vscode.extensions.getExtension('pasu4.neuropilot');
        assert.ok(extension, 'Extension pasu4.neuropilot should be installed');
        await extension.activate();
        assert.ok(extension.isActive, 'Extension pasu4.neuropilot should be active');
    });

    test('Workspace folder is correct', function() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Workspace folder should be defined');
        assert.strictEqual(workspaceFolder.name, 'test-playground', 'Workspace folder name should be test-playground');
    });
});
