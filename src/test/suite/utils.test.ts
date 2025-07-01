import * as assert from 'assert';
import * as utils from '../../utils';
import { NEURO } from '../../constants';
import { anyString, capture, reset, spy, verify } from 'ts-mockito';

suite('Utils Tests', async function() {
    test('logOutput: Log single lines', async function() {
        // === Arrange ===
        const outputChannelSpy = spy(NEURO.outputChannel);

        // === Act ===
        utils.logOutput('DEBUG', 'Lorem ipsum');
        utils.logOutput('INFO', 'dolor sit amet');

        // === Assert ===
        assert.ok(outputChannelSpy);
        verify(outputChannelSpy?.appendLine(anyString())).twice();
        const [message1] = capture(outputChannelSpy.appendLine).first();
        const [message2] = capture(outputChannelSpy.appendLine).second();

        assert.match(message1, /^\d{2}:\d{2}:\d{2}\.\d{3} \[DEBUG\] Lorem ipsum$/);
        assert.match(message2, /^\d{2}:\d{2}:\d{2}\.\d{3} \[INFO\] dolor sit amet$/);

        reset(outputChannelSpy);
    });

    test('logOutput: Log multiple lines', async function() {
        // === Arrange ===
        const outputChannelSpy = spy(NEURO.outputChannel);

        // === Act ===
        utils.logOutput('DEBUG', 'Lorem ipsum\ndolor sit amet\nconsectetur adipiscing elit');

        // === Assert ===
        assert.ok(outputChannelSpy);
        verify(outputChannelSpy.appendLine(anyString())).thrice();

        const [message1] = capture(outputChannelSpy.appendLine).first();
        const [message2] = capture(outputChannelSpy.appendLine).second();
        const [message3] = capture(outputChannelSpy.appendLine).third();

        const match1 = message1.match(/^(\d{2}:\d{2}:\d{2}\.\d{3}) \[DEBUG\] Lorem ipsum/);
        const match2 = message2.match(/^(\d{2}:\d{2}:\d{2}\.\d{3}) \[DEBUG\] dolor sit amet/);
        const match3 = message3.match(/^(\d{2}:\d{2}:\d{2}\.\d{3}) \[DEBUG\] consectetur adipiscing elit/);

        assert.ok(match1, 'First line should match timestamp and log level');
        assert.ok(match2, 'Second line should match timestamp and log level');
        assert.ok(match3, 'Third line should match timestamp and log level');

        assert.strictEqual(match1[1], match2[1], 'All messages should have the same timestamp');
        assert.strictEqual(match1[1], match3[1], 'All messages should have the same timestamp');

        reset(outputChannelSpy);
    });
});
