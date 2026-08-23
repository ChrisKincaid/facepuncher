# Punchin Project Plan (Canonical Tracker)

This file is the single source of truth for project progress.
Update this file as work is completed. Do not maintain separate plan files.

## Product Goal
# Punchin Project Plan (Canonical Tracker)

This file is the single source of truth for project progress. Update it as work is completed. Do not maintain separate plan files.

## Product Direction

Punchin is currently a browser-only application for practicing and recording vocals over a user's music. The first goal is a dependable web MVP that works locally and can later be deployed as a normal web app.

VST development and native phone apps are explicitly parked. They are separate future projects, not dependencies of the browser app and not part of the current architecture or acceptance criteria.

## Browser MVP Requirements

1. Import a user's music file and play it back.
2. Record microphone input intended for vocals while the music plays.
3. Divide the music into musical bars.
	- Offer BPM, time-signature, and Bar 1 offset controls.
	- Provide automatic BPM/offset estimation as an assist, never as the only path.
	- Allow the user to manually move each bar's start and end points.
4. Let the user choose which bars are played and which bars are recorded.
5. Support recording vocals while monitoring the music, with clear headphone guidance and a monitor on/off control.
6. Keep up to five vocal takes for every bar and let the user select the favorite take.
7. Export:
	- a finished mix (music plus selected vocals),
	- an acapella/vocals-only file using the selected bars and takes,
	- an instrumental/music-only file.
8. Preserve the project, imported audio, takes, bar edits, selections, and mix settings across reloads where browser storage permits.

## Feasibility And Main Risks

| Requirement | Browser feasibility | Main difficulty |
| --- | --- | --- |
| Import and playback | Proven browser capability | Format support, decode failures, long files, memory use |
| Microphone recording | Proven browser capability with permission | Browser permissions, device routing, latency, interruptions |
| Playback while recording | Feasible | Headphone requirement, feedback prevention, timing alignment |
| Automatic bar detection | Partially feasible | Music varies widely; confidence and manual correction are required |
| Manual bar editing | Feasible and required | Maintaining valid, contiguous boundaries and usable editing UX |
| Selective play/record bars | Feasible | Needs an explicit selection model separate from the current-bar workflow |
| Five takes per bar | Feasible | Storage size, replacement/deletion behavior, reliable selection persistence |
| Browser exports | Feasible | Offline rendering, alignment, clipping, format/sample-rate behavior |
| Persistent projects | Feasible with IndexedDB | Storage quotas, restore errors, stale object URLs, large recordings |

The hardest technical proof is synchronized monitoring and recording with acceptable latency. Headphones are the correct primary solution: speakers can feed the microphone and cause feedback, echo, and cancellation. The app should warn users and default microphone monitoring off; it cannot guarantee acoustic isolation in software.

## Current Status Snapshot

- Current phase: Phase 0 - Browser feasibility and baseline recovery
- Current focus: Make the existing browser prototype build, then prove the core audio loop
- Last updated: 2026-08-22
- VST track: Parked
- Mobile apps: Parked

## What Already Exists In The Prototype

- React/Vite browser app structure.
- WAV/MP3 import with Web Audio decoding and a ten-minute limit.
- BPM and offset estimation, manual BPM and offset controls.
- Generated bars plus waveform editing controls for bar boundaries.
- Beat playback, looping, count-in, punch-by-bar, and full-verse recording modes.
- Microphone recording through an AudioWorklet path, with latency offset support.
- Up to five takes per bar, take selection, deletion, and mix gain controls.
- IndexedDB-backed project/blob persistence.
- Offline WAV rendering for selected vocals and a beat-plus-vocals mix.

These are implementation pieces, not yet proof that every requirement works reliably end to end.

## Phase 0 - Browser Feasibility And Baseline Recovery

Status: In Progress

Objective: Establish a buildable browser baseline and verify the highest-risk workflow before adding broader features.

Work items:

1. Restore a clean build and lint baseline.
	- Fix the AudioWorklet TypeScript environment/types.
	- Update the WaveSurfer configuration to match the installed API.
	- Run `npm run build` and `npm run lint`.
2. Run a real browser smoke test with a short music file and headphones.
	- Import and decode.
	- Confirm playback, seek, loop, and bar timing.
	- Grant microphone permission.
	- Record one bar while the beat plays.
	- Confirm the take is aligned and audible without feedback.
3. Test the failure paths that can invalidate the product direction.
	- Permission denied.
	- No microphone or device switch.
	- Speakers enabled instead of headphones.
	- Unsupported/corrupt file.
	- Recording stopped immediately.
4. Decide the minimum supported browser set and audio-file policy based on results.

Exit criteria:

1. Build and lint pass.
2. One short file completes import, playback, monitored recording, take creation, and playback of the take.
3. The app clearly communicates headphone and microphone requirements.
4. Known browser/device limitations are recorded here and in the README.

## Phase 1 - Reliable Bar Editing And Practice Flow

Status: Not Started

Objective: Make musical segmentation and repeated practice dependable for music that automatic detection cannot understand.

Work items:

1. Define bar invariants: boundaries are ordered, contiguous where intended, non-zero, and never extend past the source duration.
2. Make manual editing support every bar, including first and last bars, with readable time/beat feedback.
3. Keep user edits distinguishable from regenerated automatic detection.
4. Add explicit bar playback and recording selection state rather than relying only on the current bar and loop range.
5. Test unusual BPM, time signatures, offsets, incomplete final bars, and songs with anacrusis/pickup notes.

Exit criteria: A user can import a song that automatic detection gets wrong, manually correct its bars, select a practice/recording range, and repeat it without losing edits.

## Phase 2 - Takes, Storage, And Recovery

Status: Not Started

Objective: Make vocal iteration safe and understandable over a complete session.

Work items:

1. Enforce exactly the intended five-take behavior per bar, including replace, delete, and selected-take rules.
2. Restore projects with all audio blobs, selections, bar edits, and mix settings.
3. Handle IndexedDB quota and restore failures with actionable messages.
4. Add cleanup for object URLs and abandoned recording resources.
5. Test reload, browser restart, multiple projects, large takes, and partial saves.

Exit criteria: A session can be closed and reopened without losing usable audio or selection decisions.

## Phase 3 - Export And Browser MVP Release

Status: Not Started

Objective: Produce trustworthy downloadable results and package the first browser MVP.

Work items:

1. Implement and verify three exports: finished mix, selected vocals/acapella, and instrumental/music-only.
2. Ensure exports honor bar selections, selected takes, bar timing, gains, latency correction, and source duration.
3. Test silence, clipping, overlapping takes, missing blobs, sample rates, and the final partial bar.
4. Add focused automated tests for timing math, bar editing, take selection, and export job construction where the browser audio APIs are not required.
5. Replace the template README with product setup, workflow, limitations, and troubleshooting documentation.
6. Create a manual regression checklist and a first browser release-candidate gate.

Exit criteria: All three exports are audibly and temporally correct, the core regression checklist passes, build/lint are clean, and the README describes the shipped browser behavior.

## Deferred Projects

### VST

Parked until the browser workflow proves the product behavior. A VST cannot be assumed to control a DAW's transport or multiple tracks. Any future VST project must begin with a host-capability investigation and a narrower feature contract, rather than trying to reproduce the browser app wholesale.

### Phone Apps

Parked until the browser MVP is useful and the audio interaction is understood. Native mobile development is a separate stack and should receive its own repository, requirements, and platform-specific audio/permission investigation.

## Immediate Next 3 Actions

1. Fix the two baseline TypeScript build errors and rerun build/lint.
2. Perform the short-file, headphones-required playback-plus-recording smoke test.
3. Based on that result, either repair the recording path or begin the explicit bar-selection and bar-invariant work in Phase 1.

## Progress Log

Use this format for each update:

- Date:
- Phase:
- Completed:
- Blocked:
- Next:

### Entries

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Re-scoped the product to a browser-only application; parked VST and mobile as separate future projects; documented requirements, feasibility, risks, current prototype capabilities, and the first validation order.
- Blocked: Current production build fails on AudioWorklet typings and an outdated WaveSurfer option. Browser recording/playback synchronization still needs a real-device smoke test.
- Next: Restore build/lint, then validate playback plus microphone recording with headphones.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Restored the production build by fixing AudioWorklet declarations, WaveSurfer configuration, and malformed CSS. Cleared all lint errors; four existing React hook dependency warnings remain.
- Blocked: Browser recording/playback synchronization and device behavior still need a real browser smoke test with a short music file and headphones.
- Next: Validate import, playback, microphone permission, one-bar recording, take playback, and feedback behavior in a browser.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Corrected automatic BPM detection so it supports the full 40-240 BPM editor range instead of a 60-135 BPM hip-hop ceiling. Hardened generated bar grids so non-final bars use one fixed duration and only the final bar may be truncated by the source ending.
- Blocked: The uploaded song's actual BPM and downbeat still need validation in the browser; automatic detection can estimate tempo and phase but cannot guarantee the correct musical downbeat for every song.
- Next: Reload the app and compare the generated bar times. If the non-final bars are still different lengths, share the browser page or the audio file so the exact case can be reproduced.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Removed the redundant vertical waveform sidebar and reclaimed its 80px layout column. The top transport now spans the full window, with the horizontal waveform retained as the single full-song view.
- Blocked: None for this UI change.
- Next: Continue browser smoke testing with the simplified full-width layout.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Fixed playback position tracking so AudioContext time zero is handled as a valid start time instead of a stopped-state sentinel. Play now captures one start position and applies it consistently to the audio source, playhead, and visual cursor.
- Blocked: The reported upload-specific behavior still needs browser confirmation.
- Next: Scrub to a nonzero position, press Play, and verify audible playback and the visual cursor begin together immediately.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Simplified transport UI to one Play/Pause toggle and one Stop control in the top transport, while preserving jump, nudge, BPM, count-in, and pre-roll functionality. Removed duplicate playback controls from the lower timing settings panel and synchronized waveform position before paint.
- Blocked: The Stop-to-Play visual/audio sequence still needs confirmation against the user's uploaded file.
- Next: Reload the app and retest Stop, then Play from the beginning; verify the waveform marker is at the beginning immediately and stays synchronized.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Fixed the remaining stale-canvas frame by moving waveform redraw into the layout phase and marking playback inactive before Stop changes the audio engine. This prevents an interval tick or delayed paint from restoring the prior visual position.
- Blocked: The exact Stop-to-Play sequence still requires browser confirmation with the uploaded audio.
- Next: Reload, play into the intro, press Stop, and confirm the visual marker immediately returns to 00:00 before pressing Play again.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Found that the waveform also retained an independent zoom/pan viewport after Stop. Stop now resets the waveform component itself, returning the visual to the full-song view at 00:00 together with the audio reset.
- Blocked: The browser page must be hard-refreshed once to load this latest component-state fix, then the uploaded file needs the Stop-to-Play retest.
- Next: Hard-refresh the browser page, press Stop, then Play, and confirm both audio and waveform start at 00:00.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Corrected first-load transport behavior so automatic Bar 1 detection only aligns the bar grid; newly loaded audio now always starts playback at the actual file beginning. Combined this with the Stop reset and pre-paint waveform redraw fixes so audio position and visual position share 00:00 at startup.
- Blocked: The existing browser tab must be hard-refreshed once before retesting the current code.
- Next: Hard-refresh, load the file again, press Play, then Stop and Play; audio and the visual cursor should remain aligned from 00:00.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Removed the misleading second waveform marker during playback. The stored scrub position is now shown only while stopped; during playback the waveform shows only the live audio cursor, preventing an old position such as Bar 27 from appearing to be the playback location.
- Blocked: The uploaded-file playback sequence still needs confirmation after the browser loads the latest hot-reloaded code.
- Next: Refresh the browser, load the file, scrub to a later bar, press Stop, then Play. Only the live cursor at the audible position should be visible.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Replaced the remaining two-state marker logic with one authoritative waveform position: live audio cursor while playing, stored seek position while stopped. Also resume the Web Audio context at playback start so the audio clock starts with the audible output.
- Blocked: A real uploaded-file playback test is still required to confirm the live clock against the user's specific browser/audio device.
- Next: Hard-refresh the shared browser page, load the audio, and verify the single marker starts at file time 00:00 and tracks the audible playback continuously.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Fixed the actual loop-position bug. The visual cursor was normalizing every raw position into the selected loop, including playback before the loop start, so file time 00:00 appeared at the loop's final bar. The cursor now shows true file time until the selected loop begins, then wraps only after loop end.
- Blocked: Browser confirmation with the uploaded file remains.
- Next: Reload the app, select loops such as Bars 5-10 and 5-34, and verify Play starts visually at 00:00 before entering each loop.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Added an explicit "Play selected loop" checkbox beside Loop start and Loop end. It defaults off for normal full-file playback; the selected range is sent to the audio engine only when enabled.
- Blocked: None for this UI behavior.
- Next: Reload the app and confirm unchecked playback runs through normally, then enable the checkbox and confirm the selected loop repeats.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Corrected enabled-loop playback so checking "Play selected loop" immediately starts at the selected Loop start bar and repeats through Loop end. Unchecked playback continues from the normal playhead without looping.
- Blocked: None in code; browser confirmation remains recommended.
- Next: Reload and compare checked versus unchecked playback using a short loop range.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Removed the redundant "Preview 3s" button and its separate auto-return playback workflow. Upload and normal Play are now the single entry path for hearing the imported audio; scrubbing, Stop, Bar 1, and loop controls remain available.
- Blocked: None for this walkthrough cleanup.
- Next: Continue the user walkthrough from upload and playback, then simplify the bar and recording workflow based on the next friction point.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Fixed "Set Bar 1 here" to use the actual current audio position while playing (`cursor`) or the user's scrubbed position while stopped (`playhead`). It no longer always uses the stale zero-time playhead.
- Blocked: None in code; browser confirmation remains recommended.
- Next: Scrub or play to the desired downbeat, press "Set Bar 1 here," and confirm the regenerated grid begins at that position.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Separated audio loading from bar detection. Import now decodes and loads the file without creating bars or running BPM detection. Renamed the action to "Auto-detect bars"; it is now the only automatic grid-creation path, allowing BPM and Bar 1 to be chosen first.
- Blocked: Browser walkthrough confirmation remains.
- Next: Load audio, confirm the Bars section stays empty, choose BPM/Bar 1, then click "Auto-detect bars" and verify the generated grid.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Made "Auto-detect bars" a prominent standalone action in the Import Beat panel, increased content clearance below the fixed transport so the page title is not covered, and removed the placeholder BPM display by using an empty initial value and clearing legacy no-grid projects on restore.
- Blocked: Browser walkthrough confirmation remains.
- Next: Refresh the app, upload audio, confirm the title and Auto-detect bars button are visible, and verify BPM remains blank until entered or detected.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Simplified the bar action label from "Edit edges" to "Edit" without changing its behavior.
- Blocked: None.
- Next: Continue refining the bar editor workflow one control at a time.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Added bar-editor navigation gestures: mouse-wheel zoom, one-pointer/mouse panning away from boundary handles, and two-finger pinch zoom on touch screens. Existing start/end handle dragging remains reserved for boundary editing.
- Blocked: Gesture behavior needs manual validation on a mouse and touch device; combined vertical-drag zoom is intentionally deferred to avoid making handle editing ambiguous.
- Next: Test zoom, pan, pinch, and start/end handle dragging in the bar editor before considering a combined DAW-style gesture.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Replaced the earlier wheel, pan, and pinch navigation with the confirmed interaction: vertical click-drag zoom only, centered on a Start/End selector. Boundary hit areas retain priority for start/end editing, and touch scrolling is disabled only within the waveform editor.
- Blocked: Manual mouse and touch validation remains.
- Next: Open a bar editor and test vertical zoom from empty waveform space, Start/End center selection, and both boundary-handle drags.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Clicking or dragging a bar boundary handle now automatically changes the small zoom-center selector to the corresponding Start or End option.
- Blocked: None in code; manual interaction validation remains.
- Next: Confirm the selector changes when each handle is clicked, then use the selected handle as the zoom center.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Simplified nudge behavior to one "Zero crossing" mode. The left arrow moves to the previous zero crossing and the right arrow moves to the next; fixed millisecond nudge modes remain available. Removed the redundant Snap to zero checkbox and directional dropdown options.
- Blocked: None in code; manual audio-boundary validation remains.
- Next: Select Zero crossing and verify the two arrows move each boundary in the expected direction without crossing neighboring bars.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Made "Zero crossing" the default nudge mode while retaining the fixed 5, 10, 25, 50, and 100 ms options for precision adjustments.
- Blocked: None in code.
- Next: Continue bar-editor walkthrough and validate the default nudge behavior against real audio.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Changed the default loop range from the entire song to Bar 1 through Bar 16, clamped to the final available bar for shorter songs. The same bounded default is used if scrubbing resets the loop range.
- Blocked: None in code.
- Next: Confirm the loop selectors show Bar 1 and Bar 16 after auto-detecting a song with at least 16 bars.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Added separate per-bar Play and Loop actions. Play starts at the selected bar without looping; Loop starts at that bar, sets the range to that single bar, and repeats it. Both use the top Stop control.
- Blocked: None in code; browser confirmation remains.
- Next: Test Play and Loop on an individual bar and confirm each starts at that bar's boundary.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Added contextual per-bar Stop behavior. The bar action that starts playback changes from Play or Loop to Stop; the other action remains available. Stopping restores the original labels.
- Blocked: None in code; browser confirmation remains.
- Next: Test that Play and Loop each become local Stop controls and that switching actions updates the active row correctly.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Replaced Loop start and Loop end dropdowns with direct controls on each bar. Users can click Set start on one bar and Set end on another; the active range is summarized at the top and boundary bars are visibly marked.
- Blocked: None in code; browser confirmation remains.
- Next: Test selecting loop boundaries directly from bar rows, including changing start past the current end and end before the current start.

## Priority Order
1. Browser webapp (highest priority).
2. VST path.
3. Mobile apps (lowest priority).

## Current Status Snapshot
- Current phase: Phase 1
- Current focus: Phase 1.1 Documentation baseline
- Last updated: 2026-08-22

## Current Execution Target (Do This First)
Target:
Rewrite README so it reflects the real Punchin app (not Vite template).

Definition of done:
1. README includes product purpose and current scope.
2. README includes install, run, build, and preview commands.
3. README documents primary workflow (import, detect, record, takes, export).
4. README lists known limitations and current MVP status.
5. README has a short "What is next" section aligned to Phase 1.

Output:
1. Updated README.md committed as the first concrete Phase 1 deliverable.

## Rules For Working This Plan
1. Work only one phase at a time.
2. Do not start a new phase until exit criteria for the current phase are met.
3. Keep updates short and concrete (what was done, what is blocked, what is next).
4. If scope changes, update this file first, then continue implementation.

## Phase 1 - Browser Webapp Production Hardening
Status: In Progress

Objective:
Make the existing web app stable, testable, and release-ready for real users.

Why this phase first:
1. Core workflow is already implemented in browser.
2. Fastest path to user feedback and usable release.
3. Becomes the behavior reference for VST and mobile later.

Entry Criteria:
1. Existing MVP workflow runs end-to-end locally.

Work Items:
1. Documentation baseline
- Replace template README with real product README.
- Add setup, run, build, troubleshooting, and known limitations.

2. Quality baseline
- Add test strategy for core domain logic (timing math, bar generation, take selection rules).
- Add smoke/regression checklist for record, playback, export, restore.
- Run lint/build checks as required for every milestone.

3. Reliability baseline
- Validate import edge cases (format errors, long files, low-level files, corrupted files).
- Validate recording lifecycle edge cases (permission denied, stop/start quickly, device switches).
- Validate IndexedDB restore/autosave behavior with real session scenarios.

4. UX and product polish
- Standardize status/error messaging.
- Remove or archive leftover template artifacts not used by the app.
- Confirm keyboard controls and transport behavior are predictable.

5. Release baseline
- Define semantic versioning starting point.
- Create a release checklist.
- Prepare first tagged web release candidate.

Exit Criteria:
1. README reflects real app behavior and setup.
2. Core flows pass manual regression checklist.
3. Build and lint pass consistently.
4. At least one release candidate is packaged and tested.

## Phase 2 - Shared Core Extraction
Status: Not Started

Objective:
Separate platform-agnostic domain logic from browser-specific implementation.

Work Items:
1. Define core boundaries
- Project model.
- Timing/bar math.
- Take/mix decision rules.
- Export job specification (not platform-specific audio implementation).

2. Extract shared modules
- Move platform-agnostic logic into a shared core package/module.
- Keep adapter interfaces for audio engine, storage, and file I/O.

3. Add contract tests
- Ensure shared rules behave identically after extraction.

Exit Criteria:
1. Browser app consumes shared core with no behavior regression.
2. Core logic is testable without DOM/Web Audio dependencies.

## Phase 3 - VST Track (Design then MVP)
Status: Not Started

Objective:
Prove a practical VST implementation path while preserving Punchin workflow.

Work Items:
1. Architecture decision
- Select plugin framework/toolchain.
- Define host integration limits and feature parity targets.

2. Audio engine strategy
- Map real-time constraints.
- Re-implement or adapt needed audio paths for plugin runtime.

3. Minimal VST MVP
- Basic transport sync expectations.
- Load backing audio reference.
- Punch/take behavior prototype.

4. Validation
- Test in at least two DAW hosts.
- Document unsupported behaviors and limitations.

Exit Criteria:
1. A working VST MVP proves core workflow viability in a DAW.
2. Risks and effort for full VST production are documented.

## Phase 4 - Mobile Apps (Lowest Priority)
Status: Not Started

Objective:
Deliver standalone iOS and Android apps after web and VST paths are established.

Work Items:
1. Packaging strategy
- Choose app shell and native bridge strategy.
- Define offline and storage requirements.

2. Mobile audio validation
- Latency, permissions, interruptions, routing, and background behavior.

3. UX adaptation
- Adapt layout and controls for small screens.
- Validate recording ergonomics on touch devices.

4. Store readiness
- Prepare platform compliance, privacy declarations, and release assets.

Exit Criteria:
1. Beta builds on iOS and Android complete core recording workflow.
2. Store submission checklist is complete.

## Progress Log
Use this format for each update:
- Date:
- Phase:
- Completed:
- Blocked:
- Next:

### Entries
- Date: 2026-08-22
- Phase: Phase 1
- Completed: Created canonical multi-phase project tracker with priority order (webapp -> VST -> mobile).
- Blocked: No previous in-repo plan file was found.
- Next: Replace README template with product documentation and define Phase 1 regression checklist.

- Date: 2026-08-22
- Phase: Phase 1
- Completed: Refined tracker with a single pinned execution target and explicit definition of done.
- Blocked: None.
- Next: Update README.md to complete the documentation baseline target.

## Immediate Next 3 Actions
1. Rewrite README for actual Punchin product and workflow.
2. Create a Phase 1 manual regression checklist document.
3. Define pass/fail gates for first browser release candidate.
