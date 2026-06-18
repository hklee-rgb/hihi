# Eye-Tracking Shooting Game — hihi/eye-tracking

This repository contains an accessible eye-tracking shooting game built with only HTML, CSS, and JavaScript, using Google MediaPipe FaceMesh for eye/iris tracking.

Game design prompt and specifications

Goal
- Create an accessible web-based eye-control training game for visually impaired students that uses webcam-based eye tracking to practice and strengthen eye-control skills.
- The game should be high-contrast, provide audio feedback and large UI controls, and include configurable settings for webcam selection and mirroring correction.

Target users
- Visually impaired students (low vision) and learners who need practice with eye control and gaze stability.
- Teachers and therapists who want a lightweight, browser-based training tool that runs on standard laptops or tablets with a webcam.

Core requirements (from user)
1. Display the live webcam view within the game.
2. Provide settings to select and configure the webcam, including options to correct flipped or mirrored views caused by the operating system.
3. Designed for visually impaired students to support eye control training.

High-level design
- Technology: plain HTML, CSS, JavaScript, MediaPipe FaceMesh (web CDN). No server component.
- Main elements: live video preview, overlay canvas (for gaze cursor and targets), accessible controls (start/pause/reset), settings panel (camera device select, flip/mirror toggles, sensitivity and dwell time), audio cues, and speech guidance.
- Eye tracking: use MediaPipe FaceMesh with refineLandmarks enabled to obtain iris landmarks; compute an averaged iris center for gaze position; apply smoothing and mapping to canvas coordinates; provide a dwell-time based selection (hold gaze on a target to fire).

Accessibility & UX
- High-contrast theme, large buttons and text, ARIA labels, and keyboard controls as a fallback.
- Audio feedback for hits, misses, and state changes using Web Audio API and optional spoken instructions via SpeechSynthesis.
- Configurable dwell time for selection to adjust difficulty for different abilities.

Game mechanics
- Mode: Single-player timed rounds (e.g., 60 seconds) or unlimited practice mode.
- Targets: Large, high-contrast circular targets spawn at randomized positions within the playable area. Targets may vary in size and lifetime with difficulty levels.
- Interaction: Aim using eyes (gaze cursor). To "shoot", keep the gaze cursor inside the target for the configured dwell time (e.g., 800ms). Successful dwell triggers target destroyed and audio/voice feedback.
- Scoring: Score increments for each hit; provide hit combo and accuracy stats at round end.
- Training features: calibration routine, ability to toggle mirror correction if the OS mirrors the camera, sensitivity slider to remap gaze to screen, and a practice mode with stationary/larger targets.

Privacy & performance
- All processing runs locally in the browser; webcam stream is never uploaded to external servers by the app (MediaPipe runs locally via WASM/JS).  Note: Host must be served over HTTPS for camera access in modern browsers.
- Performance considerations: default video size limited (e.g., 640x480) and FaceMesh set to single-face detection for lower CPU usage.

Files added in this commit
- README.md (this design prompt and README)
- index.html (game UI and controls)
- style.css (styles and high-contrast theme)
- script.js (game logic, MediaPipe integration, gaze mapping, audio)

How to run
1. Serve the repository files over HTTPS or from localhost (e.g., use `npx http-server` or VS Code Live Server).
2. Open `index.html` in a modern Chromium-based browser. Allow camera access when prompted.

Credits
- Uses Google MediaPipe FaceMesh web package via CDN.

