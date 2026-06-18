// EyeFlight — main script
// Requirements: display live webcam; allow camera selection & mirror toggle; designed for eye-control training.
// Uses MediaPipe FaceMesh via global FaceMesh from CDN.

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');

const cameraSelect = document.getElementById('cameraSelect');
const mirrorToggle = document.getElementById('mirrorToggle');
const dwellRange = document.getElementById('dwellRange');
const dwellValue = document.getElementById('dwellValue');
const sensitivityRange = document.getElementById('sensitivityRange');
const sensitivityValue = document.getElementById('sensitivityValue');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const timeEl = document.getElementById('time');
const scoreEl = document.getElementById('score');
const hitsEl = document.getElementById('hits');
const missesEl = document.getElementById('misses');
const modeSelect = document.getElementById('modeSelect');

let currentStream = null;
let faceMesh = null;
let running = false;
let lastResults = null;

let overlayWidth = 640, overlayHeight = 480;
let gaze = {x: overlayWidth/2, y: overlayHeight/2};
let filteredGaze = {...gaze};
let smoothing = 0.25;

let dwellTime = parseInt(dwellRange.value);
dwellRange.addEventListener('input', ()=> {
  dwellTime = parseInt(dwellRange.value);
  dwellValue.textContent = dwellTime;
});
let sensitivity = parseFloat(sensitivityRange.value);
sensitivityRange.addEventListener('input', ()=>{
  sensitivity = parseFloat(sensitivityRange.value);
  sensitivityValue.textContent = sensitivity.toFixed(2);
});

async function enumerateCameras(){
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === 'videoinput');
  cameraSelect.innerHTML = '';
  cams.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.deviceId;
    opt.textContent = c.label || `Camera ${cameraSelect.length+1}`;
    cameraSelect.appendChild(opt);
  });
}

async function startCamera(deviceId){
  stopCamera();
  const constraints = {
    audio: false,
    video: {
      deviceId: deviceId ? {exact: deviceId} : undefined,
      width: {ideal: 640},
      height: {ideal: 480},
      facingMode: 'user'
    }
  };
  try{
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = currentStream;
    await video.play();
    // adjust overlay size
    overlayWidth = video.videoWidth || 640;
    overlayHeight = video.videoHeight || 480;
    overlay.width = overlayWidth;
    overlay.height = overlayHeight;
    video.style.maxHeight = '480px';
    if (mirrorToggle.checked) video.style.transform = 'scaleX(-1)'; else video.style.transform = 'none';
    initFaceMesh();
  }catch(err){
    console.error("Camera failed:", err);
    alert("Unable to access camera: " + err.message);
  }
}

function stopCamera(){
  if(currentStream){
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
  if(faceMesh){
    try{ faceMesh.close(); }catch(e){}
    faceMesh = null;
  }
}

function initFaceMesh(){
  if(faceMesh) return;
  faceMesh = new FaceMesh({locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
  }});
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  faceMesh.onResults(onResults);

  // simple loop using requestAnimationFrame
  async function frameLoop(){
    if(!currentStream || !running) return;
    try{
      await faceMesh.send({image: video});
    }catch(e){}
    requestAnimationFrame(frameLoop);
  }
  // start loop if running
  if(running) requestAnimationFrame(frameLoop);
}

function onResults(results){
  lastResults = results;
  // results.multiFaceLandmarks is an array
  ctx.clearRect(0,0,overlayWidth,overlayHeight);

  if(!results.multiFaceLandmarks || !results.multiFaceLandmarks[0]) return;

  const landmarks = results.multiFaceLandmarks[0];

  // MediaPipe iris landmarks indices: left iris center approx indices 468-472, right 473-477.
  const leftIris = [468,469,470,471];
  const rightIris = [473,474,475,476];

  function avgPoint(idxs){
    let x=0,y=0;
    idxs.forEach(i => { x += landmarks[i].x; y += landmarks[i].y; });
    x/=idxs.length; y/=idxs.length;
    // normalized coordinates: x,y relative to video width/height
    return {x: x * overlayWidth, y: y * overlayHeight};
  }
  let li = avgPoint(leftIris);
  let ri = avgPoint(rightIris);

  // Choose one eye or average both; pick right if available
  let iris = {x: (li.x + ri.x)/2, y: (li.y + ri.y)/2};

  // Mirror correction: if video is mirrored visually, we need to flip x
  const mirrored = mirrorToggle.checked;
  if(mirrored) iris.x = overlayWidth - iris.x;

  // Sensitivity mapping: map around center to expand/contract movement
  const cx = overlayWidth/2, cy = overlayHeight/2;
  iris.x = cx + (iris.x - cx) * sensitivity;
  iris.y = cy + (iris.y - cy) * sensitivity;

  // smoothing
  filteredGaze.x += (iris.x - filteredGaze.x) * smoothing;
  filteredGaze.y += (iris.y - filteredGaze.y) * smoothing;

  // Draw gaze cursor
  drawGaze(filteredGaze.x, filteredGaze.y);

  // Let game logic know gaze position
  gameUpdateGaze(filteredGaze.x, filteredGaze.y);
}

function drawGaze(x,y){
  // clear overlay but keep small trails
  // (we clear each frame in onResults)
  // draw a big high contrast dot
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255,217,102,0.98)';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.arc(x, y, 18, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();
}

// --- Simple target management and game logic ---
let targets = [];
let spawnInterval = 1600; // ms
let spawnTimer = null;
let gameTimer = null;
let roundDuration = 60; // seconds when timed
let timeRemaining = 0;
let score = 0, hits = 0, misses = 0;
let hoveredTarget = null;
let hoverStart = 0;

function spawnTarget(){
  const minPad = 60;
  const size = Math.max(60, 120 - Math.floor(hits*2)); // reduce with hits to increase difficulty
  const x = Math.random() * (overlayWidth - size - minPad) + size/2 + minPad/2;
  const y = Math.random() * (overlayHeight - size - minPad) + size/2 + minPad/2;
  const id = Math.random().toString(36).slice(2,9);
  targets.push({id, x, y, size, alive:true, spawned:Date.now()});
}

function drawTargets(){
  for(const t of targets){
    if(!t.alive) continue;
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.arc(t.x, t.y, t.size/2, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    // inner high contrast core
    ctx.beginPath();
    ctx.fillStyle = '#ffd966';
    ctx.arc(t.x, t.y, Math.max(24, t.size/4), 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// update game overlay each frame (called from onResults)
function gameDraw(){
  // overlay already cleared at start of onResults. Draw targets last so gaze appears on top via separate drawGaze call
  drawTargets();
}

function gameUpdateGaze(x,y){
  if(!running) return;
  // find any target under gaze
  const found = targets.find(t => t.alive && distance(x,y,t.x,t.y) < t.size/2);
  if(found){
    if(hoveredTarget && hoveredTarget.id === found.id){
      // continue hovering
      const elapsed = Date.now() - hoverStart;
      // draw progress ring
      const p = Math.min(1, elapsed / dwellTime);
      drawProgressRing(found.x, found.y, Math.max(24, found.size/4), p);
      if(elapsed >= dwellTime){
        // hit
        handleHit(found);
        hoveredTarget = null;
        hoverStart = 0;
      }
    }else{
      // started hovering new target
      hoveredTarget = found;
      hoverStart = Date.now();
    }
  }else{
    // no target found
    if(hoveredTarget){
      // aborted hover -> reset
      hoveredTarget = null;
      hoverStart = 0;
    }
  }

  // redraw targets overlay (keep in sync)
  gameDraw();
}

function drawProgressRing(x,y,radius,progress){
  ctx.beginPath();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#4ee27a';
  ctx.arc(x, y, radius+10, -Math.PI/2, -Math.PI/2 + Math.PI*2*progress);
  ctx.stroke();
}

function handleHit(target){
  target.alive = false;
  hits++;
  score += 10;
  playTone(880, 0.09);
  speak("Hit");
  updateHud();
  // remove target after a short delay
  setTimeout(()=>{ targets = targets.filter(t => t.alive); }, 300);
}

function handleMiss(){
  misses++;
  playTone(220, 0.18);
  updateHud();
}

function updateHud(){
  scoreEl.textContent = score;
  hitsEl.textContent = hits;
  missesEl.textContent = misses;
}

function distance(x1,y1,x2,y2){
  const dx = x1-x2, dy = y1-y2;
  return Math.sqrt(dx*dx + dy*dy);
}

// --- Game controls ---
startBtn.addEventListener('click', ()=>{
  if(!running){
    startGame();
  }
});

pauseBtn.addEventListener('click', ()=>{
  if(running) pauseGame();
  else resumeGame();
});

resetBtn.addEventListener('click', resetGame);

calibrateBtn.addEventListener('click', runCalibration);

modeSelect.addEventListener('change', ()=>{
  if(modeSelect.value === 'timed') timeEl.textContent = `${roundDuration}s`;
  else timeEl.textContent = 'Practice';
});

// --- Game lifecycle functions ---
function startGame(){
  running = true;
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  pauseBtn.textContent = 'Pause';
  spawnTimer = setInterval(spawnTarget, spawnInterval);
  spawnTarget();
  // timed mode
  if(modeSelect.value === 'timed'){
    timeRemaining = roundDuration;
    timeEl.textContent = `${timeRemaining}s`;
    gameTimer = setInterval(()=>{
      timeRemaining--;
      timeEl.textContent = `${timeRemaining}s`;
      if(timeRemaining <= 0){
        endRound();
      }
    }, 1000);
  }else{
    timeEl.textContent = 'Practice';
  }
  // start faceMesh loop if camera already started
  running = true;
  if(faceMesh && currentStream){
    requestAnimationFrame(async function frameLoop(){
      if(!running) return;
      try{ await faceMesh.send({image: video}); }catch(e){}
      requestAnimationFrame(frameLoop);
    });
  }
  speak("Round started");
}

function pauseGame(){
  running = false;
  pauseBtn.textContent = 'Resume';
  clearInterval(spawnTimer);
  clearInterval(gameTimer);
  speak("Paused");
}

function resumeGame(){
  running = true;
  pauseBtn.textContent = 'Pause';
  spawnTimer = setInterval(spawnTarget, spawnInterval);
  if(modeSelect.value === 'timed'){
    gameTimer = setInterval(()=>{
      timeRemaining--;
      timeEl.textContent = `${timeRemaining}s`;
      if(timeRemaining <= 0) endRound();
    }, 1000);
  }
  speak("Resumed");
}

function resetGame(){
  running = false;
  targets = [];
  clearInterval(spawnTimer);
  clearInterval(gameTimer);
  spawnTimer = null;
  gameTimer = null;
  score = hits = misses = 0;
  updateHud();
  timeEl.textContent = '—';
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  pauseBtn.textContent = 'Pause';
  speak("Game reset");
}

function endRound(){
  running = false;
  clearInterval(spawnTimer);
  clearInterval(gameTimer);
  spawnTimer = null;
  gameTimer = null;
  speak(`Round over. Score ${score}. Hits ${hits}. Misses ${misses}.`);
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  timeEl.textContent = '—';
}

// --- Simple calibration routine ---
async function runCalibration(){
  speak("Calibration: please look at the center of the screen for a moment.");
  // center gaze mapping adjustment: collect samples around center and compute offset
  const samples = [];
  const duration = 1200;
  const start = Date.now();
  while(Date.now() - start < duration){
    if(lastResults && lastResults.multiFaceLandmarks && lastResults.multiFaceLandmarks[0]){
      // reuse filteredGaze as best estimate
      samples.push({x: filteredGaze.x, y: filteredGaze.y});
    }
    await new Promise(r => setTimeout(r, 80));
  }
  if(samples.length > 0){
    const avg = samples.reduce((acc,s)=>({x:acc.x+s.x,y:acc.y+s.y}), {x:0,y:0});
    avg.x /= samples.length; avg.y /= samples.length;
    const cx = overlayWidth/2, cy = overlayHeight/2;
    // adjust sensitivity slightly to align center
    const dx = (cx - avg.x) / cx;
    const adj = 1 + dx * 0.08;
    sensitivity = Math.min(2.0, Math.max(0.5, sensitivity * adj));
    sensitivityRange.value = sensitivity.toFixed(2);
    sensitivityValue.textContent = sensitivity.toFixed(2);
    speak("Calibration complete.");
  }else{
    speak("Calibration failed. No face detected.");
  }
}

// --- Audio & Speech utilities ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(freq, dur=0.1){
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  o.connect(g);
  g.connect(audioCtx.destination);
  g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.01);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.stop(audioCtx.currentTime + dur + 0.02);
}

function speak(text){
  if(!("speechSynthesis" in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

// --- helpers & startup ---
function resizeCanvasToVideo(){
  overlay.width = video.videoWidth || overlayWidth;
  overlay.height = video.videoHeight || overlayHeight;
  overlayWidth = overlay.width;
  overlayHeight = overlay.height;
}

// update mirror in CSS
mirrorToggle.addEventListener('change', ()=>{
  if(mirrorToggle.checked) video.style.transform = 'scaleX(-1)';
  else video.style.transform = 'none';
});

// camera selection change
cameraSelect.addEventListener('change', async ()=>{
  await startCamera(cameraSelect.value);
});

async function init(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    alert("Camera API not supported.");
    return;
  }
  await enumerateCameras();
  if(cameraSelect.options.length > 0){
    await startCamera(cameraSelect.value);
  }else{
    // try default
    await startCamera();
  }
  // ensure overlay matches video when playing
  video.addEventListener('loadeddata', ()=>{
    resizeCanvasToVideo();
  });
  // update HUD defaults
  updateHud();
  timeEl.textContent = '—';
  // accessibility: announce ready
  speak("EyeFlight is ready. Select a camera and press Start.");
}

// small render loop to ensure targets and gaze render even when no face updates
function smallLoop(){
  if(lastResults === null){
    ctx.clearRect(0,0,overlayWidth,overlayHeight);
    drawTargets();
    drawGaze(filteredGaze.x, filteredGaze.y);
  }
  requestAnimationFrame(smallLoop);
}

init().catch(console.error);
smallLoop();

// expose stop on unload
window.addEventListener('beforeunload', ()=> stopCamera());
