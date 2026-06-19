// Chord Inversions Game: uses Web MIDI API; integrates a simple Space-Invaders-like game

const ALL_CHORD_TYPES = [
  {id:'major', name: 'Major', intervals: [0, 4, 7]},
  {id:'minor', name: 'Minor', intervals: [0, 3, 7]},
  {id:'dim', name: 'Diminished', intervals: [0, 3, 6]}
];
const INVERSION_NAMES = ['Root position', '1st inversion', '2nd inversion'];

let midiAccess = null;
let activeNotes = new Map(); // midi -> velocity
let detectTimer = null;
let target = null;
let score = 0;
let lives = 3;
let gameRunning = false;

const els = {
  status: document.getElementById('status'),
  target: document.getElementById('target'),
  request: document.getElementById('request'),
  feedback: document.getElementById('feedback'),
  next: document.getElementById('next'),
  hint: document.getElementById('hint'),
  score: document.getElementById('score'),
  keyboard: document.getElementById('keyboard'),
  startBtn: document.getElementById('startGame'),
  stopBtn: document.getElementById('stopGame'),
  lives: document.getElementById('lives'),
  ctMajor: document.getElementById('ct-major'),
  ctMinor: document.getElementById('ct-minor'),
  ctDim: document.getElementById('ct-dim'),
  invRoot: document.getElementById('inv-root'),
  inv1: document.getElementById('inv-1'),
  inv2: document.getElementById('inv-2'),
  modeAuto: document.getElementById('mode-auto'),
  mode2: document.getElementById('mode-2'),
  mode3: document.getElementById('mode-3'),
  inv1: document.getElementById('inv-1'),
  inv2: document.getElementById('inv-2'),
  remaining: document.getElementById('remaining'),
  canvas: document.getElementById('gameCanvas')
};

const ctx = els.canvas.getContext('2d');
let invaders = [];

// Audio setup for key clicks and MIDI (Web Audio API)
const audioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ? new (window.AudioContext || window.webkitAudioContext)() : null;
function midiToFreq(m){ return 440 * Math.pow(2, (m - 69)/12); }
function playNote(midi, duration=0.35, type='sine'){
  if(!audioCtx) return;
  if(audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
  try{
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = midiToFreq(midi);
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.01);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration + 0.02);
  }catch(e){ console.warn('Audio error', e); }
}

const PREF_KEY = 'chord_inversions_prefs';
function savePrefs(){
  try{
    const prefs = {
      ctMajor: !!(els.ctMajor && els.ctMajor.checked),
      ctMinor: !!(els.ctMinor && els.ctMinor.checked),
      ctDim: !!(els.ctDim && els.ctDim.checked),
      invRoot: !!(els.invRoot && els.invRoot.checked),
      inv1: !!(els.inv1 && els.inv1.checked),
      inv2: !!(els.inv2 && els.inv2.checked),
      mode: (els.mode2 && els.mode2.checked) ? '2' : (els.mode3 && els.mode3.checked) ? '3' : 'auto',
      keys: keyboardOctaves
    };
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  }catch(e){ console.warn('Could not save prefs', e); }
}

function loadPrefs(){
  try{
    const raw = localStorage.getItem(PREF_KEY);
    if(!raw) return;
    const p = JSON.parse(raw);
    if(els.ctMajor) els.ctMajor.checked = !!p.ctMajor;
    if(els.ctMinor) els.ctMinor.checked = !!p.ctMinor;
    if(els.ctDim) els.ctDim.checked = !!p.ctDim;
    if(els.invRoot) els.invRoot.checked = !!p.invRoot;
    if(els.inv1) els.inv1.checked = !!p.inv1;
    if(els.inv2) els.inv2.checked = !!p.inv2;
    if(els.mode2) els.mode2.checked = p.mode === '2';
    if(els.mode3) els.mode3.checked = p.mode === '3';
    if(els.modeAuto) els.modeAuto.checked = !p.mode || p.mode === 'auto';
    if(p.keys) setKeyboardOctaves(p.keys);
    updateKeysCountDisplay();
  }catch(e){ console.warn('Could not load prefs', e); }
}

function targetIsIncluded(tgt){
  if(!tgt) return false;
  // chord type allowed?
  const types = enabledChordTypes();
  if(!types.some(tt => tt.id === (tgt.type && tgt.type.id))) return false;
  // inversion allowed? if user selected inversions, require match
  const invs = enabledInversions();
  if(invs.length > 0 && !invs.includes(tgt.inversion)) return false;
  // note mode compatibility
  const mode = getNoteMode();
  if(mode === '2' && tgt.notes.length !== 2) return false;
  if(mode === '3' && tgt.notes.length !== 3) return false;
  return true;
}

function ensureTargetStillValid(){
  if(!target) return;
  if(!targetIsIncluded(target)){
    els.feedback.textContent = 'Target changed to match new settings';
    els.feedback.style.color = '#93c5fd';
    newRound();
  }
}

function bindPrefListeners(){
  const elems = [els.ctMajor, els.ctMinor, els.ctDim, els.invRoot, els.inv1, els.inv2, els.modeAuto, els.mode2, els.mode3];
  elems.forEach(el => { if(el) el.addEventListener('change', ()=>{ savePrefs(); ensureTargetStillValid(); }); });
  const km = document.getElementById('keys-more');
  const kl = document.getElementById('keys-less');
  if(km) km.addEventListener('click', ()=>{ changeKeyboardOctaves(1); savePrefs(); });
  if(kl) kl.addEventListener('click', ()=>{ changeKeyboardOctaves(-1); savePrefs(); });
  // update display when user uses octave shift buttons too
  const octUpBtn = document.getElementById('oct-up');
  const octDownBtn = document.getElementById('oct-down');
  if(octUpBtn) octUpBtn.addEventListener('click', ()=>{ updateKeysCountDisplay(); savePrefs(); });
  if(octDownBtn) octDownBtn.addEventListener('click', ()=>{ updateKeysCountDisplay(); savePrefs(); });
}

let invaderDir = 1; // unused for static wave
let invaderSpeed = 0.12; // base speed for visual only
let beam = null; // {x,y,vy,active}
let time = 0;
let level = 1;

function getRandomInt(a,b){return Math.floor(Math.random()*(b-a+1))+a}

function enabledChordTypes(){
  const enabled = [];
  if(els.ctMajor && els.ctMajor.checked) enabled.push(ALL_CHORD_TYPES[0]);
  if(els.ctMinor && els.ctMinor.checked) enabled.push(ALL_CHORD_TYPES[1]);
  if(els.ctDim && els.ctDim.checked) enabled.push(ALL_CHORD_TYPES[2]);
  return enabled.length? enabled : ALL_CHORD_TYPES;
}

function enabledInversions(){
  const arr = [];
  if(els.invRoot && els.invRoot.checked) arr.push(0);
  if(els.inv1 && els.inv1.checked) arr.push(1);
  if(els.inv2 && els.inv2.checked) arr.push(2);
  return arr; // may be empty -> means "any inversion" (quality-only)
}

function getNoteMode(){
  if(els.mode2 && els.mode2.checked) return '2';
  if(els.mode3 && els.mode3.checked) return '3';
  return 'auto';
}

function generateTarget(){
  const types = enabledChordTypes();
  const type = types[Math.floor(Math.random()*types.length)];
  const root = getRandomInt(48,72); // C3 .. C5
  const invs = enabledInversions();
  const choices = invs.length ? invs : [0,1,2];
  let inversion = choices[Math.floor(Math.random()*choices.length)];
  // base intervals
  let intervals = (type.intervals || []).slice();
  // Apply note-mode (2 or 3)
  const mode = getNoteMode();
  if(mode === '2') intervals = intervals.slice(0,2);
  if(mode === '3' && intervals.length < 3){
    // if not enough intervals (unlikely), pad using standard triad intervals when available
    intervals = (type.intervals && type.intervals.length>=3) ? type.intervals.slice(0,3) : intervals;
  }
  if(inversion >= intervals.length) inversion = 0;
  const notes = intervals.map(i => (root + i) % 12);
  return {root, type, inversion, notes};
}

function noteNameFromPC(pc){
  const N = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return N[pc%12];
}

function showTarget(){
  els.target.textContent = `${noteNameFromPC(target.root)} ${target.type.name}`;
  const requireInv = enabledInversions().length > 0; // if user selected inversions, require specific inversion
  els.request.textContent = requireInv ? `${INVERSION_NAMES[target.inversion]}` : `Any inversion (quality only)`;
}

function newRound(){
  activeNotes.clear();
  if(detectTimer){ clearTimeout(detectTimer); detectTimer = null; }
  target = generateTarget();
  showTarget();
  els.feedback.textContent = '';
}

function flattenToPitchClasses(noteMap){
  const pcs = new Set();
  for(const [midi] of noteMap){
    pcs.add(midi%12);
  }
  return pcs;
}

// helper to draw rounded rectangles
function roundRect(ctx, x, y, w, h, r, fill, stroke){
  if (typeof r === 'undefined') r = 5;
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  if(fill) ctx.fill();
  if(stroke) ctx.stroke();
}

// Compatibility aliases (some environments/scripts use lowercase)
if(typeof window !== 'undefined'){
  window.roundRect = roundRect;
  window.roundrect = roundRect;
}
if(typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r, fill=true, stroke=false){
    roundRect(this, x, y, w, h, r, fill, stroke);
  };
}

function expectedBassPC(){
  const idx = target.inversion;
  return target.notes[idx];
}

function hitInvader(){
  // find top-most invader in center to remove
  const alive = invaders.filter(iv=>iv.alive);
  if(alive.length===0) return false;
  // pick the lowest-y alive invader (closest)
  const targetInv = alive[alive.length-1];
  targetInv.alive = false;
  return true;
}

function evaluateAttempt(){
  const pcs = flattenToPitchClasses(activeNotes);
  const targetSet = new Set(target.notes);
  const same = pcs.size === targetSet.size && [...pcs].every(x => targetSet.has(x));
  const requireInv = enabledInversions().length > 0;
  let bassGood = false;

  if(same){
    const lowest = Math.min(...[...activeNotes.keys()]);
    const lowestPC = lowest % 12;
    bassGood = (lowestPC === expectedBassPC());
  }

  const isCorrect = same && (!requireInv || bassGood);

  if(isCorrect){
    els.feedback.textContent = 'Nice hit!';
    els.feedback.style.color = '#10b981';
    score += 1;
    els.score.textContent = `Score: ${score}`;
    // advance runner
    runnerPos += stepPerHit;
    // clear selected keys so user starts fresh
    activeNotes.clear();
    if(detectTimer){ clearTimeout(detectTimer); detectTimer = null; }
    document.querySelectorAll('#keyboard .key').forEach(k=>k.classList.remove('down'));
    // immediately set up next chord
    setTimeout(()=>{ newRound(); }, 200);
  } else if(same && requireInv && !bassGood){
    els.feedback.textContent = 'Right notes, wrong inversion (bass)';
    els.feedback.style.color = '#f59e0b';
  } else {
    els.feedback.textContent = 'Miss';
    els.feedback.style.color = '#ef4444';
  }
}

function scheduleEvaluate(){
  if(detectTimer) clearTimeout(detectTimer);
  detectTimer = setTimeout(function checkAndEval(){
    if(!target) return;
    const pcs = flattenToPitchClasses(activeNotes);
    const needed = new Set(target.notes).size;
    if(pcs.size >= needed && pcs.size>0){
      evaluateAttempt();
    } else {
      // still selecting notes; wait a bit longer before checking again
      detectTimer = setTimeout(checkAndEval, 400);
    }
  }, 600);
}

function onMIDIMessage(e){
  const [status, data1, data2] = e.data;
  const cmd = status & 0xf0;
  if(cmd === 0x90 && data2>0){ // note on
    activeNotes.set(data1, data2);
    // highlight matching on-screen key if present
    const keyEl = document.querySelector(`#keyboard .key[data-midi='${data1}']`);
    if(keyEl) keyEl.classList.add('down');
    // play sound for MIDI input
    try{ playNote(data1, 0.35, 'sine'); }catch(e){}
    scheduleEvaluate();
  } else if((cmd === 0x80) || (cmd===0x90 && data2===0)){
    activeNotes.delete(data1);
    const keyEl = document.querySelector(`#keyboard .key[data-midi='${data1}']`);
    if(keyEl) keyEl.classList.remove('down');
  }
}

function connectMIDIPorts(){
  if(!midiAccess) return;
  for(const input of midiAccess.inputs.values()){
    input.onmidimessage = onMIDIMessage;
  }
  els.status.textContent = 'MIDI ready. Play chord on your keyboard.';
}

async function initMIDI(){
  if(!navigator.requestMIDIAccess){
    els.status.textContent = 'Web MIDI API not available in this browser.';
    return;
  }
  try{
    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.onstatechange = connectMIDIPorts;
    connectMIDIPorts();
  }catch(err){
    els.status.textContent = 'MIDI permission denied or unavailable.';
    console.error(err);
  }
}

// On-screen keyboard for testing without MIDI
let keyboardBase = 48; // MIDI number for left-most key (C3 default)
let keyboardOctaves = 3; // how many octaves to display (editable)
function updateKeysCountDisplay(){ const el = document.getElementById('keys-count'); if(el) el.textContent = keyboardOctaves; }
function setKeyboardOctaves(n){ keyboardOctaves = Math.max(1, Math.min(7, Math.round(n))); updateKeysCountDisplay(); buildKeyboard(); }
function changeKeyboardOctaves(delta){ setKeyboardOctaves(keyboardOctaves + delta); }

function midiToOctave(m){ return Math.floor(m/12)-1; }
function midiToNoteLabel(m){ return noteNameFromPC(m%12) + midiToOctave(m); }

function buildKeyboard(){
  // clear existing
  const wrap = document.getElementById('keyboard-wrap');
  const kb = document.getElementById('keyboard');
  kb.innerHTML = '';

  const whiteKeys = [0,2,4,5,7,9,11];
  const total = keyboardOctaves * 12;
  for(let i=0;i<total;i++){
    const midi = keyboardBase + i;
    const pc = midi % 12;
    const isBlack = !whiteKeys.includes(pc);
    const key = document.createElement('div');
    key.className = 'key' + (isBlack? ' black':'');
    const label = document.createElement('div');
    label.className = 'note-label';
    label.textContent = noteNameFromPC(pc);
    key.appendChild(label);
    key.dataset.midi = midi;
    key.addEventListener('click', ()=>{
      // toggle selection on click so user can click multiple keys
      if(activeNotes.has(midi)){
        activeNotes.delete(midi);
        key.classList.remove('down');
      } else {
        activeNotes.set(midi, 127);
        key.classList.add('down');
        // play click sound
        try{ playNote(midi, 0.28, 'sine'); }catch(e){}
      }
      scheduleEvaluate();
    });
    kb.appendChild(key);
  }

  // remove old clear if exists
  const existing = document.getElementById('clear-keys-btn');
  if(existing) existing.remove();

  // add clear button
  const clearBtn = document.createElement('button');
  clearBtn.id = 'clear-keys-btn';
  clearBtn.textContent = 'Clear keys';
  clearBtn.style.marginLeft = '12px';
  clearBtn.addEventListener('click', ()=>{
    activeNotes.clear();
    if(detectTimer){ clearTimeout(detectTimer); detectTimer = null; }
    document.querySelectorAll('#keyboard .key').forEach(k=>k.classList.remove('down'));
  });
  wrap.parentElement.insertBefore(clearBtn, wrap.nextSibling);

  updateOctaveLabel();
}

function updateOctaveLabel(){
  const el = document.getElementById('keyboard-octave');
  if(!el) return;
  // show leftmost as note name + octave
  el.textContent = midiToNoteLabel(keyboardBase);
}

function shiftKeyboard(deltaOctaves){
  keyboardBase += deltaOctaves*12;
  // clamp reasonable range
  if(keyboardBase < 24) keyboardBase = 24; // C1 min
  if(keyboardBase > 84) keyboardBase = 84; // C7 max
  buildKeyboard();
  // keep keyboard visible centered
  const wrap = document.getElementById('keyboard-wrap');
  wrap.scrollLeft = 0;
}

function centerKeyboard(){
  const wrap = document.getElementById('keyboard-wrap');
  wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth)/2;
}

// Runner Game engine
let trackLength = 100; // units to finish

// Responsive canvas resizing for mobile
function resizeCanvas(){
  if(!els.canvas) return;
  // set logical size to element size so drawing scales crisply
  const rect = els.canvas.getBoundingClientRect();
  // respect device pixel ratio
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(300, Math.floor(rect.width * dpr));
  const h = Math.max(160, Math.floor(rect.height * dpr || rect.width * 0.45 * dpr));
  if(els.canvas.width !== w || els.canvas.height !== h){
    els.canvas.width = w;
    els.canvas.height = h;
    // scale drawing context for DPR
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
}

window.addEventListener('resize', ()=>{ resizeCanvas(); draw(); });
window.addEventListener('orientationchange', ()=>{ setTimeout(()=>{ resizeCanvas(); draw(); }, 300); });

let runnerPos = 0; // 0..trackLength
let stepPerHit = 20; // advance per correct hit

function spawnTrack(lengthUnits=100){
  trackLength = lengthUnits;
  runnerPos = 0;
  if(els.remaining) els.remaining.textContent = `Distance: ${Math.max(0, trackLength - runnerPos)}`;
}

function updateRunner(){
  // nothing time-based: runner moves only on correct hits; keep drawing updated
  if(els.remaining) els.remaining.textContent = `Distance: ${Math.max(0, trackLength - runnerPos)}`;
  // check finish
  if(runnerPos >= trackLength){
    level += 1;
    els.feedback.textContent = `Level ${level-1} complete! Starting level ${level}`;
    // increase track and reset
    setTimeout(()=>{
      spawnTrack(Math.min(500, 100 + (level-1)*50));
      newRound();
    }, 800);
  }
}

function draw(){
  ctx.clearRect(0,0,els.canvas.width,els.canvas.height);
  const pad = 30;
  const w = els.canvas.width - pad*2;
  const h = els.canvas.height;

  // draw track line
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(pad, h/2);
  ctx.lineTo(pad + w, h/2);
  ctx.stroke();

  // draw finish line
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(pad + w - 6, h/2 - 40, 6, 80);

  // draw runner
  const t = Math.max(0, Math.min(1, runnerPos / trackLength));
  const rx = pad + Math.floor(t * w);
  const ry = h/2 - 12;
  // runner body
  ctx.fillStyle = '#fff';
  roundRect(ctx, rx-12, ry-12, 24, 24, 6, true, false);
  // head
  ctx.fillStyle = '#f97316';
  ctx.beginPath(); ctx.arc(rx, ry-18, 8, 0, Math.PI*2); ctx.fill();

  // progress text
  ctx.fillStyle = '#e6eef8';
  ctx.font = '14px sans-serif';
  ctx.fillText(`Level ${level} — Progress: ${Math.min(100, Math.round(t*100))}%`, pad, 20);
}

function gameLoop(){
  if(!gameRunning) return;
  updateRunner();
  draw();
  requestAnimationFrame(gameLoop);
}

function startGame(){
  if(gameRunning) return;
  gameRunning = true;
  score = 0; level = 1;
  runnerPos = 0;
  spawnTrack(100);
  els.score.textContent = `Score: ${score}`;
  requestAnimationFrame(gameLoop);
}

function stopGame(){
  gameRunning = false;
}

// UI wiring
els.next.addEventListener('click', ()=>{ newRound(); });
els.hint.addEventListener('click', ()=>{
  els.feedback.textContent = 'Notes: ' + target.notes.map(n=>noteNameFromPC(n)).join(' - ');
  els.feedback.style.color = '#93c5fd';
});
els.startBtn.addEventListener('click', ()=>{ startGame(); });
els.stopBtn.addEventListener('click', ()=>{ stopGame(); });

// init
buildKeyboard();
loadPrefs();
bindPrefListeners();
initMIDI();
// hook octave controls (buttons are in DOM since script is at page end)
const octUpBtn = document.getElementById('oct-up');
const octDownBtn = document.getElementById('oct-down');
const centerBtn = document.getElementById('center-keyboard');
if(octUpBtn) octUpBtn.addEventListener('click', ()=>shiftKeyboard(1));
if(octDownBtn) octDownBtn.addEventListener('click', ()=>shiftKeyboard(-1));
if(centerBtn) centerBtn.addEventListener('click', ()=>centerKeyboard());

// Mobile settings modal: move controls into modal when opened so mobile view focuses on game+keyboard
const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
const mobileModal = document.getElementById('mobile-settings-modal');
const mobileContainer = document.getElementById('mobile-settings-container');
const mobileClose = document.getElementById('mobile-settings-close');
const controlsEl = document.getElementById('controls');
let controlsPlaceholder = null;
function openMobileSettings(){
  if(!controlsEl || !mobileContainer) return;
  // insert placeholder to restore location later
  controlsPlaceholder = document.createElement('div');
  controlsPlaceholder.id = 'controls-placeholder';
  controlsEl.parentElement.insertBefore(controlsPlaceholder, controlsEl);
  // move controls into modal container
  mobileContainer.appendChild(controlsEl);
  mobileModal.setAttribute('aria-hidden', 'false');
}
function closeMobileSettings(){
  if(!controlsPlaceholder) return;
  // move controls back
  controlsPlaceholder.parentElement.insertBefore(controlsEl, controlsPlaceholder);
  controlsPlaceholder.remove();
  controlsPlaceholder = null;
  mobileModal.setAttribute('aria-hidden', 'true');
}
if(mobileSettingsBtn) mobileSettingsBtn.addEventListener('click', openMobileSettings);
if(mobileClose) mobileClose.addEventListener('click', closeMobileSettings);
// close modal on backdrop click
if(mobileModal) mobileModal.addEventListener('click', (ev)=>{ if(ev.target === mobileModal) closeMobileSettings(); });

// make canvas responsive for phones
resizeCanvas();
// show initial track and target
spawnTrack(100);
draw();
newRound();
