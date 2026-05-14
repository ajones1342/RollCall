"""
RollCall scene-preset sync for OBS.

Posts to POST /api/vtt/scene every time the program scene changes, with the
OBS scene name as the preset name. Name your RollCall scene presets to match
the OBS scene names you want them to activate on. OBS scenes that don't
match any preset fall through to clearing the active preset (so the overlay
reverts to per-character hide toggles).

Setup
-----
1. Install Python 3.6 - 3.11, 64-bit (matching OBS). 3.12+ is NOT supported
   by OBS scripting yet and will show "Python not currently loaded" in the
   settings panel. On Windows the quickest path is:
       winget install Python.Python.3.11
   which installs to C:\\Users\\<you>\\AppData\\Local\\Programs\\Python\\Python311.
2. In OBS: Tools -> Scripts -> Python Settings, point it at your Python
   install (the folder containing python.exe / python3 dylib, not the exe
   itself). Restart OBS if it prompts.
3. Tools -> Scripts -> + (Add) -> select this file.
4. Fill in Endpoint URL and Campaign token. Both are shown in RollCall's
   campaign manage page under Scene presets -> "Auto-switch from OBS".
5. (Optional) Toggle "Log to OBS script log" to see scene names and POST
   results in Tools -> Scripts -> Script Log while you're wiring things up.

Naming
------
Match exactly (case-insensitive, whitespace trimmed). If your OBS scene is
"Stream end", name your RollCall preset "Stream end".

Failure modes
-------------
- 401: token wrong/blank -> check Endpoint URL and Campaign token.
- 404: scene name doesn't match a preset -> script automatically clears
  the active preset. This is the expected path for "normal" scenes.
- Network blip: request is fire-and-forget on a background thread, errors
  are logged when debug is on. No retry; next scene change recovers.
"""

import json
import threading
import urllib.error
import urllib.request

import obspython as obs  # type: ignore[import-not-found]  # provided by OBS at runtime

_endpoint = ""
_token = ""
_debug = False


def script_description():
    return (
        "RollCall — sync the active scene preset to your OBS scene.\n"
        "Switching scenes in OBS will activate the RollCall preset of the "
        "same name (case-insensitive). Scenes without a matching preset "
        "clear the active preset."
    )


def script_properties():
    props = obs.obs_properties_create()
    obs.obs_properties_add_text(
        props, "endpoint", "Endpoint URL", obs.OBS_TEXT_DEFAULT
    )
    obs.obs_properties_add_text(
        props, "token", "Campaign token", obs.OBS_TEXT_PASSWORD
    )
    obs.obs_properties_add_bool(props, "debug", "Log to OBS script log")
    obs.obs_properties_add_button(
        props, "test_btn", "Send current scene now", _on_test_button
    )
    return props


def script_defaults(settings):
    obs.obs_data_set_default_string(
        settings, "endpoint", "https://your-rollcall-host.example.com/api/vtt/scene"
    )
    obs.obs_data_set_default_string(settings, "token", "")
    obs.obs_data_set_default_bool(settings, "debug", False)


def script_update(settings):
    global _endpoint, _token, _debug
    _endpoint = obs.obs_data_get_string(settings, "endpoint").strip()
    _token = obs.obs_data_get_string(settings, "token").strip()
    _debug = obs.obs_data_get_bool(settings, "debug")


def script_load(settings):
    obs.obs_frontend_add_event_callback(_on_event)


def script_unload():
    # OBS removes frontend callbacks for unloaded scripts automatically.
    pass


# ── event handling ────────────────────────────────────────────────────────


def _on_event(event):
    if event != obs.OBS_FRONTEND_EVENT_SCENE_CHANGED:
        return
    name = _current_scene_name()
    if name is None:
        return
    _log(f"scene -> {name!r}")
    threading.Thread(target=_post_scene, args=(name,), daemon=True).start()


def _on_test_button(_props, _prop):
    # "Send current scene now" — useful for confirming token + URL work
    # without having to actually switch scenes.
    name = _current_scene_name() or ""
    _log(f"manual send -> {name!r}")
    threading.Thread(target=_post_scene, args=(name,), daemon=True).start()
    return False  # don't refresh the properties UI


def _current_scene_name():
    source = obs.obs_frontend_get_current_scene()
    if source is None:
        return None
    try:
        return obs.obs_source_get_name(source)
    finally:
        obs.obs_source_release(source)


# ── HTTP ──────────────────────────────────────────────────────────────────


def _post_scene(scene_name):
    if not _endpoint or not _token:
        _log("skipped POST — endpoint or token is blank")
        return
    status = _post(scene_name)
    if status == 404:
        # No preset with that name — clear instead, so "normal" scenes
        # revert the overlay to per-character hides.
        _log(f"no preset named {scene_name!r}, clearing")
        _post(None)


def _post(preset):
    """POST the preset name (or None to clear). Returns the HTTP status int
    on response, or 0 on transport failure."""
    body = json.dumps({"preset": preset}).encode("utf-8")
    req = urllib.request.Request(
        _endpoint,
        data=body,
        headers={
            "Authorization": f"Bearer {_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            _log(f"POST {preset!r} -> {r.status}")
            return r.status
    except urllib.error.HTTPError as e:
        _log(f"POST {preset!r} -> {e.code} {e.reason}")
        return e.code
    except Exception as e:
        _log(f"POST {preset!r} -> transport error: {e}")
        return 0


# ── logging ───────────────────────────────────────────────────────────────


def _log(msg):
    if _debug:
        print(f"[RollCall] {msg}")
