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

## Current Browser Test Checklist

Use this checklist in order. Do not change sync, calibration, or bar boundaries until the earlier step passes. Record the exact first failing step and the status text shown there.

### A. Fresh Start And Audio

1. Hard-refresh the app with `Ctrl+Shift+R`.
2. Confirm the page title, Import Beat panel, and `Calibrate audio` button are visible.
3. Confirm no audio file is loaded, no bars are shown, and BPM is blank or unset.
4. Confirm the browser microphone permission is allowed for `127.0.0.1`.
5. Load a short WAV or MP3 file.
6. Confirm the waveform appears and playback starts at `00:00`.
7. Press Play, then Stop. Confirm the audio and visual marker both start and stop at the same positions.

### B. Bar Grid

8. Confirm loading the file did not create bars automatically.
9. Set BPM manually if known, or click `Auto-detect bars`.
10. Confirm non-final bars have equal duration and only the final bar may be shorter.
11. Confirm the default loop shows Bar 1 through Bar 16, or the final available bar for a shorter file.
12. Play the full file with `Play selected loop` unchecked. Confirm it does not wrap at the selected loop end.
13. Check `Play selected loop`, play, and confirm it repeats only the selected range.

### C. Bar Editing

14. Open Bar 1 with `Edit`.
15. Confirm the editor opens without changing the surrounding page layout.
16. Confirm `Maintain bar length` is checked.
17. Drag Start backward and forward. Confirm End moves with it and the bar duration stays constant.
18. Drag End backward and forward. Confirm Start moves with it and the bar duration stays constant.
19. Click the Start handle and confirm the zoom center changes to Start. Click the End handle and confirm it changes to End.
20. Turn `Maintain bar length` off. Confirm Start and End can move independently.
21. Turn `Allow gaps` on, move a boundary, and confirm a gap can appear without allowing overlap.
22. Click the `?` help control and confirm it explains maintained length, gap risk, and overlap prevention.

### D. Single-Bar Take

23. Close the editor with `Done`.
24. On one bar, arm the first empty take. Confirm it turns red and the next empty slot appears.
25. Confirm the status tells you to start that bar with Play or Loop.
26. Put on wired headphones and keep microphone monitoring off.
27. Click that same bar's Play button. Confirm recording starts automatically when the bar begins; no separate Record button should be needed.
28. Say or sing a clear test phrase on the beat.
29. Confirm the bar continues playing after recording completes.
30. Confirm Take 1 turns amber and its playback light turns on.
31. Play the bar again without an armed take. Confirm the selected vocal take is audible with the beat.
32. Click `No take`. Confirm the instrumental plays without the vocal take.

### E. Multiple Takes And Consecutive Bars

33. Arm the next take on the same bar. Confirm it turns red without hiding the following empty slot.
34. Arm up to five take slots. Confirm all armed slots remain visible in order and no sixth slot appears.
35. Record successive passes. Confirm each pass fills the next armed slot in order.
36. Lock a recorded take. Confirm it cannot be deleted or overwritten.
37. Delete an unlocked take in the middle. Confirm later takes compact left with no gaps.
38. Select a different recorded take with its playback light. Confirm only that take plays.
39. Arm Takes 1 on Bars 1 and 2, then start playback from the top transport. Confirm both bars record when playback enters them.
40. Run a loop with adjacent armed bars. Confirm the next armed bar records on the same pass instead of waiting for a later pass.

### F. Sync Correction

41. Record a clear `1, 2, 3, 4` test on one bar.
42. Replay it and confirm the recorded performance is audibly present.
43. Change `Recording sync` while playback continues. Confirm the beat does not stop.
44. Confirm the current vocal moves relative to the beat without changing the recorded performance.
45. Test `-100 ms`, `+100 ms`, `-10 ms`, `+10 ms`, and `Exact ms`.
46. Confirm the same global sync correction affects selected takes in multiple bars, not only the current bar.
47. Press `Reset` and confirm the global correction returns to `0 ms`.

### G. Failure And Evidence Capture

48. Stop during an active recording. Confirm the partial take either saves clearly or reports why it was discarded.
49. Attempt recording with no armed take. Confirm no recording starts and the app explains what to do.
50. If anything fails, copy the final visible status message and the last five `[Punchin]` console messages. Do not change settings before recording that evidence.

### Current Pass/Fail Gate

The first required gate is steps 23-32. Do not evaluate calibration, multi-bar recording, or export until one take can be recorded and played back audibly on the same bar. The second gate is steps 39-40. The third gate is steps 41-47.

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

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed the exact one-bar loop playback handoff. After saving a take, the next-loop timer was passing the prior end-of-bar audio position into the take scheduler, causing it to start near the end of the take and sound silent. The handoff now starts the saved take from offset zero at the next loop boundary.
- Blocked: Fresh-browser confirmation remains.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Replaced the tangle of competing take-playback paths (playLoopingTakeAt free-running loop source, playSelectedTake offset math, and the directTakeScheduled/activeLoopingTake/singleBarLoop guard flags) with a single rule: on every bar entry — including loop wraps — restart that bar's selected take from position 0 at constant gain via audioEngine.playTakeFromStart. This removes the offset-based re-trigger that made repeated loops play only the tail ("9,10") at the end of the bar. Recorded takes are cached decoded on save so playback is instant. Build 0 errors, lint 5 known warnings.
- Blocked: Needs live confirmation that a one-bar loop now plays the full take on every pass.
- Next: Confirm in browser, then commit a new GitHub checkpoint.
- Next: Repeat the documented one-bar test without changing sync: after Take 1 turns amber, the next loop should play the complete saved performance.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Replaced the timer/decode-at-boundary handoff with preloaded AudioContext scheduling. The exact saved WAV is decoded immediately after recording, then scheduled from sample zero at the next loop boundary with an explicit duration/take diagnostic.
- Blocked: Fresh-browser confirmation remains.
- Next: Repeat the one-bar loop test without changing sync and verify `scheduling saved take for next loop boundary` includes the take ID and duration before audible playback.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Simplified the one-bar saved-take handoff again to use the exact recorded AudioBuffer already in memory. Removed the second decode race at the loop boundary and schedule the saved take directly from sample zero with its decoded duration and take ID.
- Blocked: Fresh-browser confirmation remains.
- Next: Repeat the one-bar loop test without changing sync; verify the saved Take 1 is audible on the next loop.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Removed duplicate vocal scheduling on the first loop after recording. A direct saved-take source is now marked as scheduled so the ordinary bar-entry scheduler cannot start a second competing source, eliminating the crackle and misplaced playback caused by two sources fighting.
- Blocked: Fresh-browser confirmation remains.
- Next: Repeat the exact one-bar test without changing sync or loop settings and listen for one clean Take 1 playback on the next loop.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed one-bar recorded-take playback ending after one pass. The saved vocal source now loops when the selected beat loop contains one bar, so the recorded take continues playing on every loop pass instead of relying on a one-time handoff.
- Blocked: Fresh-browser confirmation remains; vocal/beat loop lengths still need comparison if the recorded take has a different duration than the edited bar.
- Next: Repeat the one-bar workflow and listen through at least three loop passes for continuous recorded vocal playback.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed the second-loop "glip" caused by the normal vocal scheduler replacing the continuously looping saved take with a one-shot source. Active one-bar loop vocal playback is now protected from replacement and the guard clears when loop mode or range changes.
- Blocked: Fresh-browser confirmation remains.
- Next: Repeat the one-bar test and listen through three or more passes for the complete take without a crackle or tiny end fragment.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Hardened the one-bar loop playback path by disabling the ordinary selected-take scheduler for single-bar loops and keeping the direct saved-take source active across every wrap. The direct source is no longer cleared at the first wrap, preventing later one-shot replacement and repeat-pass glitches.
- Blocked: Fresh-browser confirmation remains.
- Next: Repeat the exact one-bar workflow and listen through multiple passes for continuous, clean vocal playback.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Repaired the dedicated looping saved-vocal source to use constant gain in loop mode instead of one-shot fade scheduling. This avoids the fade envelope silencing later passes and keeps the looping take audible across the selected loop.
- Blocked: Fresh-browser confirmation remains.
- Next: Repeat the exact one-bar workflow through at least three passes and verify the full saved take remains audible on every pass.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Added a dedicated `playLoopingTakeAt` audio path for one-bar saved takes. It uses one constant-gain looping AudioBufferSourceNode with one scheduled start, avoiding the general fade/replace playback path entirely.
- Blocked: Fresh-browser confirmation remains.
- Next: Repeat the exact one-bar test and verify the saved Take 1 remains continuously audible on every loop pass.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Added focused AudioContext and take-source diagnostics, including context creation/state, user Play requests, beat source start, recording boundaries, take save metadata, and looping take source scheduling.
- Blocked: The existing console output showed autoplay-block warnings but no Punchin lifecycle messages, so the next capture must include the new user-gesture logs.
- Next: Hard-refresh, perform the one-bar test, and send only the `[Punchin]` lines from top-level Play through take save and looping take source start.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Isolated the one-bar vocal loop source by removing the ordinary selected-take scheduler from single-bar loop wraps. The saved take's dedicated looping source is now the only vocal source for the one-bar loop, preventing later passes from replacing it with a one-shot fragment.
- Blocked: Fresh-browser confirmation remains.
- Next: Repeat the exact one-bar test and verify the saved take plays continuously on the first, second, and third loops.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Removed the direct-bar recording race by attaching and starting microphone capture before starting the bar's beat playback. Unarmed bars still start playback normally; armed bars now begin capture before the audible bar schedule.
- Blocked: Top-level playback entering an armed bar still starts capture at the observed bar boundary and needs real-device timing validation.
- Next: Hard-refresh, arm one take, click that same bar's Play, and compare the recording start against the bar start using headphones.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Reworked microphone capture to remain continuously connected after permission. Takes are now extracted as bounded segments from the uninterrupted capture buffer instead of disconnecting/reconnecting the recorder per bar. Selected vocal playback now uses short fade-in/fade-out transitions to reduce boundary clicks and audible seams.
- Blocked: Continuous capture currently retains the session buffer in memory and requires real-device validation for long sessions, loop transitions, and exact frame alignment.
- Next: Test consecutive armed bars and multiple takes with headphones; verify no bar-start audio is chopped and selected vocal changes do not click or gap.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Replaced chunk-arrival-based take timing with AudioWorklet sample-clock timestamps. The continuously captured microphone stream now extracts each take from the exact audio-frame range for its bar, bounded to the bar duration, while selected vocal playback keeps short crossfades.
- Blocked: USB microphone hardware latency, browser input buffering, long-session memory use, and multi-bar/loop playback still require real-device validation. A configurable latency offset may still be needed for a specific setup.
- Next: Compare a recorded count-in or clap against bar boundaries across consecutive armed bars and repeated loops; inspect the result for any remaining constant offset.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Anchored take extraction to the exact source bar timestamp and applied latency correction at the extraction start instead of trimming the finished take. Direct bar playback now schedules once before capture begins, preserving the full bar duration and avoiding duplicate-start timing drift.
- Blocked: Real-device latency calibration remains; the configured latency offset may need adjustment for the USB mic/browser setup.
- Next: Hard-refresh, record a spoken or clapped count on the beat, and compare the saved take playback. Adjust Latency Offset only if the offset is consistent across bars.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Added first-record audio calibration with a compact dialog. Automatic speaker calibration plays built-in clicks and measures their microphone arrival; manual wired-headphone calibration uses the same built-in clicks with the user clapping along. The measured correction is stored, applied to take extraction, and can be repeated with Recalibrate audio. All playback paths are gated consistently before an armed recording.
- Blocked: Calibration hit detection and correction still require real speaker/headphone testing across devices; Bluetooth remains unsupported.
- Next: Hard-refresh, arm a take, start playback, complete one calibration mode, then verify the resulting correction and recording alignment.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Removed automatic calibration popups and renamed the action to "Calibrate audio". Recording attempts are no longer interrupted; calibration runs only when the user explicitly opens it.
- Blocked: Calibration remains optional and needs manual validation when the user chooses it.
- Next: Refresh, arm a take, and verify playback/recording starts directly without a calibration dialog; use Calibrate audio separately when desired.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed calibration compensation direction. A measured late microphone arrival was previously added to the extraction point, making recordings later; it is now inverted so late input is extracted earlier. Versioned the stored calibration key to invalidate the prior incorrect result automatically.
- Blocked: The corrected calibration must be rerun and tested with the actual speaker/headphone setup.
- Next: Hard-refresh, use Recalibrate audio or trigger first-record setup, complete calibration again, then record a clear 1-2-3-4 test and compare playback.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Slowed both calibration paths to a human-usable one-click-per-second pattern with a four-click count-in followed by six measured clicks. Updated wired-headphone instructions to wait through the count-in and clap along only with the measured clicks.
- Blocked: The calibration detector and correction still need real speaker and wired-headphone validation.
- Next: Run Calibrate audio with speakers, then repeat with wired headphones and verify the measured correction is consistent.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Added one global project-level Recording sync correction. Captured take samples remain unchanged; the correction shifts selected vocal playback and export together. Added coarse +/-1 second, fine +/-1 millisecond, and Reset controls.
- Blocked: Negative live-preview shifts are limited by the fact that a vocal cannot be scheduled before the current bar entry; export applies the full global placement shift. Calibration remains optional and should not be treated as a replacement for manual sync testing.
- Next: Record a clear test phrase, use Recording sync to align it, and verify the same correction is heard in preview and reflected in export.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed the global sync preview path. Negative corrections now trigger a selected take before the bar boundary instead of skipping into its audio, while positive corrections schedule it later; the same correction remains applied during export. Recorded samples are unchanged.
- Blocked: Manual browser validation remains, especially confirming audible movement at +/-1 ms and larger shifts while replaying a selected take.
- Next: Record one take, replay it, change Recording sync in both directions, and verify the vocal moves relative to the beat without changing its performance.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Connected all Recording sync slider and nudge buttons to the live re-sync path. Changing the global value during playback now restarts only the selected vocal at the current beat position and logs the applied value/bar/time; the instrumental continues uninterrupted.
- Blocked: Browser confirmation remains.
- Next: During a loop, change Recording sync while a selected take is audible and verify the vocal moves immediately without restarting the beat.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Corrected global sync scope. Every bar-entry vocal playback now receives the same project sync value, and any in-flight take decode from the old sync generation is discarded. Export continues to apply the same global value to every selected take.
- Blocked: Browser validation remains for multiple bars with selected takes and a sync change during playback.
- Next: Set different selected takes on multiple bars, change Recording sync once, and verify all bars use the same correction without restarting the beat.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Removed the unnecessary +/-1 second global sync cap. Recording sync now allows manual correction from -10,000 ms to +10,000 ms while retaining 1-second and 1-millisecond adjustment buttons.
- Blocked: Large corrections still need browser validation; corrections exceeding a bar may move a take outside its normal bar context.
- Next: Refresh and verify the sync slider can move beyond -1 second, then find the smallest correction that aligns the take.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed global sync updates being stale during playback. The sync controls now reapply the vocal immediately without stopping the beat and reset the take-entry marker so the next bar/take uses the new correction as well.
- Blocked: Browser validation remains for live current-take movement and next-bar behavior.
- Next: During playback, change Recording sync and verify the beat continues while the vocal repositions immediately.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Improved global Recording sync controls. The slider now moves in 10 ms steps, and adjustment buttons now provide 1 second, 100 ms, 10 ms, and 1 ms increments in both directions. Added direct exact-millisecond entry for fast rough positioning and precise final tuning.
- Blocked: Browser validation remains for finding a practical correction on the user's setup.
- Next: Use Exact ms for a rough correction, then 10 ms/1 ms controls while the take is playing to finalize alignment.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed the remaining stale global-sync state path. The playback scheduler now reads an immediately updated project-wide sync ref, while sync changes invalidate old pending vocal playback and reapply the new value without stopping the beat.
- Blocked: Browser validation remains across multiple bars/takes during one continuous loop.
- Next: Change Recording sync during playback and verify the current vocal and subsequent selected takes all use the same correction without restarting transport.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed the first-take Bar 1 reproduction where a take armed after playback had already entered the looping bar missed the recording trigger. Arming a take during an active bar now marks that bar as already seen and waits for the next real loop entry before starting capture; it never begins mid-bar.
- Blocked: Browser confirmation remains for Bar 1 looping and first-take playback.
- Next: Start playback, set a one-bar loop, arm Take 1 during the active pass, and verify the next loop turns the bar recording indicator red and produces an audible amber take.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed one-bar loop take playback by keeping recording-entry tracking separate from selected-take playback tracking. A take recorded in a one-bar loop can now be requested on the following loop entry; added a diagnostic showing bar, audio position, and selected take ID.
- Blocked: Browser confirmation remains for the exact Bar 1 record-then-playback sequence.
- Next: Run the one-bar loop test and confirm the console shows `selected take playback requested` after the take turns amber.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Added an explicit saved-take handoff for active loops. After a take is saved, the exact saved take and ID are scheduled for the next loop boundary, bypassing stale React take state and bar-index entry guards.
- Blocked: Browser confirmation remains for audible playback of the first take in a one-bar loop.
- Next: Hard-refresh, record one take in a one-bar loop, and check for `scheduling saved take for next loop boundary` followed by audible vocal playback.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Added a direct Listen action to every recorded take's compact action menu. It decodes and plays the exact cached take independently of loop scheduling, reports decoded duration and peak level, and leaves the beat transport untouched.
- Blocked: The direct saved-take path needs one browser confirmation; automatic next-loop playback remains a separate path under investigation.
- Next: After a take turns amber, open its action menu and click Listen. This isolates whether the saved WAV itself is audible before testing automatic loop handoff again.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Added a live microphone level meter and gated calibration completion on detected hits. Speaker calibration now waits for all 10 built-in clicks; wired-headphone calibration waits for 6 user claps after the four-click count-in, with visible progress such as 0/6 and 5/6.
- Blocked: Real-device testing is required to tune transient detection thresholds and confirm calibration does not count noise or miss valid claps.
- Next: Run the manual clap calibration without clapping initially to confirm it remains active, then clap all six measured beats and verify completion.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Hardened calibration hit validation so manual mode requires one detected clap within each of the six expected post-count-in beat windows; arbitrary noise or the count-in cannot complete it. Added explicit in-dialog progress wording and retained the live microphone meter.
- Blocked: Real-device validation remains necessary to tune the detection window and threshold for different microphones and rooms.
- Next: Hard-refresh, open Calibrate audio, choose wired headphones, confirm it remains open before clapping, then clap once per measured click after the count-in.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Prevented calibration lockups by limiting detection scans to chunks captured during the current calibration. Manual mode now runs a longer click track, requires six consecutive correctly timed claps after the count-in, resets its streak after a missed beat, and displays live microphone level/progress while waiting.
- Blocked: Real-device validation remains necessary to confirm the meter scale and transient threshold with the user's microphone.
- Next: Refresh, choose Calibrate audio and wired headphones, wait through the count-in without clapping, then clap six consecutive measured clicks and verify completion.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed consecutive armed-bar recording so entering a new armed bar finalizes the previous take segment and immediately starts the next segment without stopping beat playback or reconnecting the microphone. Added a transition diagnostic showing the previous and next bar/take targets.
- Blocked: Real four-bar-loop validation remains; asynchronous segment finalization and exact boundary alignment need confirmation with headphones.
- Next: Arm Bars 1-3, loop them, and verify one pass creates Takes 1 for Bars 1, 2, and 3 rather than deferring Bar 2 to a later pass.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Replaced layout-changing Focused and Playing badges with a fixed bar status strip. Idle is gray, playing is cyan, and active recording is red; active rows also receive stronger stable highlighting, so bar positions no longer change during playback or editing.
- Blocked: None in code; visual validation remains.
- Next: Refresh the app and verify bar rows stay fixed while playback moves between bars and while recording begins/ends.

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

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Added a checked-by-default "Maintain bar length" option to the bar editor. With it enabled, dragging or nudging either boundary shifts the opposite boundary to preserve the current duration; disabling it restores independent start/end adjustment.
- Blocked: Exact-length movement is constrained by neighboring bars and the audio duration when a boundary reaches an available limit.
- Next: Test maintained-length movement on first, middle, and final bars, then test independent movement with the option unchecked.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Added a compact per-bar "No take" playback option beside the take pads. Selecting it clears that bar's selected vocal so the instrumental plays alone; it is disabled while a take is armed for recording.
- Blocked: Browser validation remains.
- Next: Record/select a take, switch the bar to No take, and confirm playback returns to instrumental-only audio.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Added bar-editor boundary options for "Maintain bar length" and "Allow gaps", plus a clickable question-mark explanation. Gaps are allowed only when explicitly enabled; overlap is always clamped out to protect playback and recording ownership.
- Blocked: Manual validation remains, including testing maintained-length movement at neighboring and final-bar limits.
- Next: Open a bar editor, click the help control, and verify the warning and both boundary modes with real bars.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed a regression in maintained-length editing that incorrectly blocked forward movement. With gaps disabled, a maintained-length boundary can now move across the neighboring grid position so the parent continuity logic shifts the adjacent boundary; with gaps enabled, neighbor limits still prevent overlap.
- Blocked: Manual validation remains for forward/backward movement on first, middle, and final bars.
- Next: Test moving both Start and End forward and backward with Maintain bar length enabled, then repeat with Allow gaps enabled.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Fixed the opposite-direction regression in maintained-length editing. End movement no longer uses a forward-only clamp, so both Start and End can move backward or forward while preserving the bar duration. Audio and gap/overlap limits remain enforced.
- Blocked: Manual validation remains for both directions on first, middle, and final bars.
- Next: Refresh the browser and verify Bar 1's Start and End handles move both directions with Maintain bar length enabled.

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
- Completed: Added the first usable per-bar take workflow. Each bar now exposes five sequential take pads with empty, recorded, and record-armed states; recorded takes have a playback/export selection light; lock and delete actions are visible; deletion is compacted per bar; and the ambiguous bar-level Rec button was removed.
- Blocked: Loop-pass take advancement, direct recording into armed multi-bar selections, and real microphone validation remain to be completed. Existing saved take data has no lock metadata, which safely defaults to unlocked.
- Next: Validate the take interaction on the main screen, then implement loop-pass behavior with explicit Stay on take and Advance take modes.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Moved the five take controls into each bar's former placeholder waveform area and made them compact color-first pads. Removed the take controls from the action area so bar rows do not expand unnecessarily; the generic bar-level Rec button remains removed.
- Blocked: Real microphone recording and loop-pass behavior still need validation and implementation.
- Next: Open the live app, confirm the per-bar pads fit the row, then test arming, selecting, locking, and deleting before wiring multi-pass recording.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Removed the unused section-label dropdown and reclaimed its bar-row column. Changed take rendering to show only the recorded takes plus the next available slot, with at least one empty slot and a maximum of five.
- Blocked: None in code; browser layout validation remains.
- Next: Confirm the compact progressive take display in the live app.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Rebalanced bar rows to reduce empty vertical and horizontal space. Compact take pads now occupy the former waveform area, Set start and Set end share one horizontal group, the Edit/control column is narrower, and secondary take actions appear only on hover/focus without increasing row height.
- Blocked: None in code; live browser visual validation remains.
- Next: Refresh the app and confirm the bar rows remain compact while Rec, Lock, and Delete actions are accessible from a take pad.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Fixed progressive take-slot visibility so arming the current next slot reveals the following empty slot. Users can now arm Take 1, then Take 2, then Take 3 and onward without the armed slot disappearing or blocking the next choice.
- Blocked: None in code; live browser validation remains.
- Next: Confirm a bar shows red armed plus a new gray empty slot after each arm action, capped at five slots.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Changed take arming from one slot to an ordered queue of up to five slots per bar. Multiple red slots can now be armed; each completed recording uses and removes the first queued slot while leaving later armed slots ready for subsequent passes. Canceling a red slot removes only that slot.
- Blocked: Real microphone recording and repeated-pass behavior still need browser validation.
- Next: Arm several takes on one bar, record successive passes, and verify recordings fill the queued slots in order.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Improved microphone recording startup and finalization. Record now prepares the microphone immediately from the user action, reports permission/device failures in the app, and uses an explicit recording-active flag so timed recording completion reliably saves the captured take.
- Blocked: Browser permission may not prompt again after approval; the browser's site microphone setting controls whether access is allowed. Actual microphone capture still needs testing with an armed take and headphones.
- Next: Refresh the app, arm one red take slot, press Record, allow microphone access if prompted, and verify a recorded amber take appears after the bar completes.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Added microphone preparation on page load. The app now requests access or reacquires the previously permitted device immediately after refresh and reports microphone ready/unavailable status.
- Blocked: A MediaStream cannot persist across a page refresh; the browser must create a new stream. Permission persistence and automatic reacquisition depend on browser/site settings and still need device validation.
- Next: Refresh the app and verify the USB microphone prompt appears when permission is unset, then verify a permitted device reconnects without a prompt.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Hardened the microphone capture path. Blank BPM no longer creates an invalid count-in delay, the count-in timer clears when it fires, pending AudioWorklet frames are flushed before take assembly, and zero-sample recordings now report an explicit input-device error.
- Blocked: Actual USB microphone capture still needs a browser test with a red armed take; permission already granted may not prompt again.
- Next: Hard-refresh, arm one take, press Record, and verify the status changes to Recording and then creates an amber take with captured audio.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Replaced the generic Record command with take-driven recording. The Punch Flow Record button is removed; when a bar has a red armed take and the user starts that bar with Play or Loop, the microphone is prepared and recording begins automatically at the bar start. Unarmed bars continue to play audio only.
- Blocked: Automatic recording from top-level full-song playback, multi-bar armed recording, repeated loop-pass advancement, and real USB microphone capture still need validation and implementation.
- Next: Hard-refresh, arm one take on a bar, press that bar's Play action, and verify the status changes to Recording before the take becomes amber.

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
- Phase: Phase 0
- Completed: Added focused console diagnostics for take arming, bar Play/Loop clicks, microphone permission, recorder startup, incoming AudioWorklet frames, capture stop, zero-sample failure, and take encoding.
- Blocked: The live browser must load the latest bundle and run one armed-bar playback attempt before the microphone failure point can be identified.
- Next: Hard-refresh, arm one take, click that bar's Play action, wait for the bar to finish, and report the `[Punchin]` console messages and final status text.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Promoted recording diagnostics from `console.debug` to visible `console.log` messages and added a startup marker: `[Punchin] recording diagnostics loaded`.
- Blocked: The pasted browser output contains only unrelated CSS and selector messages, not Punchin recording diagnostics.
- Next: Hard-refresh and confirm the startup marker appears before running one armed-bar playback attempt.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Diagnosed and fixed two issues from the microphone logs. The visual cursor was applying selected-loop wrapping even when loop playback was disabled, causing audio/visual desynchronization; microphone frames were also still being accepted after capture stopped. Cursor wrapping is now gated by loopEnabled, and recorder input is disconnected/ignored after stop.
- Blocked: The pasted logs confirmed microphone frames but did not include the final stop/save messages; browser confirmation remains.
- Next: Hard-refresh, run one armed-bar playback, and verify normal playback tracks visually without loop wrapping and stopped recording no longer emits frame logs.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Confirmed the take-driven recording UI is present in the live served app, with no generic Record button. Added visible status guidance after arming a take so the user knows to start that bar with Play or Loop; build and lint remain clean.
- Blocked: The user must hard-refresh the browser and use the bar-level Play/Loop action, not the top-level Play control, for the automatic armed-take recording path.
- Next: Hard-refresh, arm one take, click that same bar's Play button, and capture the final `[Punchin] stopping microphone capture` and `recording take encoded` messages.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Corrected the recording trigger to be playback-source independent. The shared playback clock now detects entry into any armed bar and starts its queued take automatically, whether playback began from the top transport, bar Play, or bar Loop. Recording no longer depends on a generic Record button or a specific playback control.
- Blocked: Repeated loop-pass recording into multiple queued takes still needs its own pass scheduler; this change starts and captures the armed take for each bar entry.
- Next: Hard-refresh, arm one take before playback, start from the top transport or any bar playback control, and verify the take starts when the armed bar begins.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Fixed take completion stopping the beat. Automatic take finalization now disconnects and saves microphone capture without stopping the beat transport, so playback continues into later bars or loop passes. Global Stop still stops both playback and recording.
- Blocked: Headphone-based recording validation remains.
- Next: Hard-refresh, arm one take, start playback, and verify the beat continues after the first take is saved.

- Date: 2026-08-22
- Phase: Phase 0
- Completed: Improved take controls and playback. Enlarged the Lock/Delete/Rec popover and removed the hover gap that caused it to disappear while moving the pointer. Added an actual selected-take audio source: unarmed bars with a selected take now play that vocal take aligned to the bar, while armed bars remain reserved for recording.
- Blocked: Browser validation of selected vocal playback and microphone recording remains.
- Next: Hard-refresh, confirm an amber take is audible when its bar plays, and verify a red armed take records instead of playing the previous take.

- Date: 2026-08-22
- Phase: Phase 1
- Completed: Refined tracker with a single pinned execution target and explicit definition of done.
- Blocked: None.
- Next: Update README.md to complete the documentation baseline target.

- Date: 2026-08-23
- Phase: Phase 0
- Completed: Verified one-bar loop recording, save, and repeated take playback in Firefox. Recording now uses one MediaRecorder session per take, starts before beat playback, remains locked through asynchronous finalization, and no longer competes with the AudioWorklet capture path.
- Blocked: The recording tail may end slightly early and remains under observation. Shift Vocals updates are audible live but reset when the bar loops.
- Next: Make the persisted Shift Vocals correction apply identically to live adjustment and every subsequent bar entry without restarting transport.

## Immediate Next 3 Actions
1. Fix Shift Vocals persistence across loop restarts.
2. Confirm whether recording consistently trims the final syllable and correct the stop boundary if reproduced.
3. Remove temporary recording diagnostics after the audio workflow is stable.
