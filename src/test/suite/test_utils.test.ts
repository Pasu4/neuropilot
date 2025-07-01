import * as assert from 'assert';
import * as testUtils from '../test_utils';
import * as vscode from 'vscode';

suite('Test Utils', () => {
    test('assertProperties', async function() {
        const expected = { a: 1, b: 'test', c: true };
        const actualGood1 = { a: 1, b: 'test', c: true };
        const actualGood2 = { a: 1, b: 'test', c: true, d: 'extra' }; // Extra property is allowed
        const actualBad1 = { a: 1, b: 'test', c: false }; // Wrong property
        const actualBad2 = { a: 1, b: 'test' }; // Missing property
        const actualBad3 = { a: 1, b: 'test', d: 'extra' }; // Extra property but missing one

        testUtils.assertProperties(expected, expected, 'The same object should pass');
        testUtils.assertProperties(actualGood1, expected, 'An identical object should pass');
        testUtils.assertProperties(actualGood2, expected, 'An otherwise correct object with extra properties should pass');

        assert.throws(() => {
            testUtils.assertProperties(actualBad1, expected, 'This should fail');
        }, 'An object with a wrong property value should fail');
        assert.throws(() => {
            testUtils.assertProperties(actualBad2, expected, 'This should fail');
        }, 'An object missing a property should fail');
        assert.throws(() => {
            testUtils.assertProperties(actualBad3, expected, 'This should fail');
        }, 'An object with an extra property but missing one should fail');
    });

    test('checkWithTimeout: Check passes within timeout', async function() {
        let checkedValue = false;
        setTimeout(() => {
            checkedValue = true;
        }, 500);

        await testUtils.checkWithTimeout(() => checkedValue, 1000, 100);
        assert.ok(checkedValue, 'check should be set to true before timeout');
    });

    test('checkWithTimeout: Check times out', async function() {
        let checkedValue = false;
        setTimeout(() => {
            checkedValue = true;
        }, 1500); // Longer than the timeout

        assert.rejects(async () => {
            await testUtils.checkWithTimeout(() => checkedValue, 1000, 100);
        });
    });

    test('checkNoErrorWithTimeout: Check passes within timeout', async function() {
        let checkedValue = false;
        setTimeout(() => {
            checkedValue = true;
        }, 500);

        function check() {
            if (!checkedValue) throw new Error();
        }

        await testUtils.checkNoErrorWithTimeout(check, 1000, 100);
        assert.ok(check, 'check should succeed before timeout');
    });

    test('checkNoErrorWithTimeout: Check passes within timeout', async function() {
        let checkedValue = false;
        setTimeout(() => {
            checkedValue = true;
        }, 1500); // Longer than the timeout

        function check() {
            if (!checkedValue) throw new Error();
        }

        assert.rejects(async () => {
            await testUtils.checkNoErrorWithTimeout(check, 1000, 100);
        });
    });
});

suite('File creation utils', () => {
    teardown(async function() {
        // Delete all test files created during the tests
        const testFilesDir = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'test_files');
        await vscode.workspace.fs.delete(testFilesDir, { recursive: true, useTrash: false });
    });

    test('createTestFile', async function() {
        const fileName = 'testFile.js';
        const content = 'console.log("Hello, world!");';
        const uri = await testUtils.createTestFile(fileName, content);
        const stat = await vscode.workspace.fs.stat(uri);

        assert.strictEqual(stat.type, vscode.FileType.File, `${fileName} should be a file`);
        const fileContent = (await vscode.workspace.fs.readFile(uri)).toString();
        assert.strictEqual(fileContent, content, `Content of ${fileName} should match the expected content`);
    });

    test('createTestDirectory', async function() {
        const dirName = 'testDirectory';
        const uri = await testUtils.createTestDirectory(dirName);
        const stat = await vscode.workspace.fs.stat(uri);

        assert.strictEqual(stat.type, vscode.FileType.Directory, `${dirName} should be a directory`);
    });
});
