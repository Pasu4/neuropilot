import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Asserts that an object has the same properties as the expected object,
 * and that the values of those properties match.
 * Additional properties in the actual object are ignored.
 */
export function assertProperties(actual: unknown, expected: unknown, message?: string): void {
    try {
        assert.ok(typeof actual === 'object', 'Actual value must be an object.');
        assert.ok(actual !== null, 'Actual value must not be null.');
        assert.ok(typeof expected === 'object', 'Expected value must be an object.');
        assert.ok(expected !== null, 'Expected value must not be null.');
        for (const key in expected) {
            assert.ok(key in actual, `Expected property "${key}" to exist in the actual object.`);
            const expectedValue: unknown = expected[key as keyof typeof expected];
            const actualValue: unknown = actual[key as keyof typeof actual];
            assert.strictEqual(actualValue, expectedValue, `Expected property "${key}" to have value "${expectedValue}", but got "${actualValue}".`);
        }
    } catch (erm) {
        if (erm instanceof assert.AssertionError && message) {
            erm.message = `${message}\n\t--> ${erm.message}`;
        }
        throw erm;
    }
}

export async function createTestFile(name: string, content?: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'test_files', name);
    await vscode.workspace.fs.writeFile(uri, content ? Buffer.from(content) : new Uint8Array(0));
    return uri;
}

export async function createTestDirectory(name: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'test_files', name);
    await vscode.workspace.fs.createDirectory(uri);
    return uri;
}

/**
 * Wait for the given given function to return true, or reject after a timeout.
 * @param check The function to check.
 * @param timeoutMs The maximum time to wait for the function to return true.
 * @param interval The interval to check the function.
 */
export function checkWithTimeout(check: () => boolean, timeoutMs = 1000, interval = 100): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            reject(new Error(`Function did not complete within ${timeoutMs} ms`));
        }, timeoutMs);

        const checkInterval = setInterval(() => {
            if (check()) {
                clearTimeout(timeout);
                clearInterval(checkInterval);
                resolve();
            }
        }, interval);
    });
}

/**
 * Wait for the given function to not throw an error, or reject after a timeout.
 * @param check The function to check.
 * @param timeoutMs The maximum time to wait for the function to not fail.
 * @param interval The interval to check to function.
 */
export function checkNoErrorWithTimeout(check: () => void, timeoutMs = 1000, interval = 100): Promise<void> {
    return checkWithTimeout(() => {
        try {
            check();
            return true;
        } catch {
            return false;
        }
    }, timeoutMs, interval);
}
