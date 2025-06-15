import json
from neuro_api_tony.api import NeuroAPI, ActionResultCommand
import asyncio

async def wait_for_startup(api: NeuroAPI):
    while not api.current_game:
        await asyncio.sleep(0.1)

async def wait_for_action_result(api: NeuroAPI):
    prev = api.on_action_result
    triggered = False
    def trigger(_: ActionResultCommand):
        nonlocal triggered
        triggered = True
    api.on_action_result = trigger
    while not triggered:
        await asyncio.sleep(0.1)
    api.on_action_result = prev

async def wait_for_actions_force(api: NeuroAPI):
    while not api.action_forced:
        await asyncio.sleep(0.1)

async def main():
    asyncio_loop = asyncio.get_event_loop()
    api = NeuroAPI(run_sync_soon_threadsafe=asyncio_loop.call_soon_threadsafe)
    api.start(address="localhost", port=8000)

    await wait_for_startup(api)

    # Expecting user to write "I have a file with some code that needs fixing. It's called fixme.js, can you help me with that?"
    await wait_for_actions_force(api)
    await asyncio.sleep(1)
    api.send_action("id_1", "chat", json.dumps({"answer": "Sure, I'll see what I can do."}))
    await wait_for_action_result(api)
    await asyncio.sleep(3)

    api.send_action("id_2", "get_files", None)
    await wait_for_action_result(api)
    await asyncio.sleep(2)

    api.send_action("id_3", "open_file", json.dumps({"filePath": "fixme.js"}))
    await wait_for_action_result(api)
    await asyncio.sleep(2)

    api.send_action("id_4", "run_current_file", None)
    await wait_for_action_result(api)
    await asyncio.sleep(5)

    api.send_action("id_5", "replace_text", json.dumps({
        "find": "greetign",
        "replaceWith": "greeting",
        "match": "firstInFile",
    }))
    await wait_for_action_result(api)
    await asyncio.sleep(2)

    api.send_action("id_6", "run_current_file", None)
    await wait_for_action_result(api)
    await asyncio.sleep(5)

    api.send_action("id_7", "replace_text", json.dumps({
        "find": ".replace('%s', greetingFormat)",
        "replaceWith": ".replace('%s', greetingTarget)",
        "match": "firstAfterCursor",
    }))
    await wait_for_action_result(api)
    await asyncio.sleep(2)

    api.send_action("id_8", "run_current_file", None)
    await wait_for_action_result(api)
    await asyncio.sleep(5)

    api.send_action("id_9", "request_cookie", json.dumps({"flavor": "Chocolate Chip"}))
    await wait_for_action_result(api)
    await asyncio.sleep(2)
    
    api.stop()

asyncio.run(main())
