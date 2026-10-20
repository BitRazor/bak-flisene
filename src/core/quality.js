// Which look a device gets. A first guess from the device itself (its graphics chip by name, its memory, whether it
// is a phone), then the frame governor watches how fast frames really come while the visitor moves, and steps the
// look down (plain glass first, then sharpness, then the live mirror: GOVERNOR_STEPS) when they are slow. Pure,
// unit-tested.
//
// Why not cores and memory: Safari reports 4 cores and no memory for every iPhone (WebKit caps it), so a core count
// sends every iPhone to the reduced look; Chrome caps memory at 8 GB, so a mid-range Android with a weak chip looked
// like a strong one (review 2026-10-19).

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;

// Graphics chips known to draw this room's full look at a phone's frame rate (by family and model number).
function strongChip(gpu) {
  const g = String(gpu || '');
  if (/apple/i.test(g)) return true; // Apple's own chips (Safari only says "Apple GPU")
  if (/immortalis|xclipse/i.test(g)) return true;
  const adreno = g.match(/adreno[^0-9]*(\d{3})/i);
  if (adreno) {
    const n = Number(adreno[1]);
    return n >= 640 || (n >= 700 && n < 1000);
  }
  const mali = g.match(/mali-?\s*g(\d{2,3})(?:\s*m[cp]\s*(\d+))?/i);
  if (mali) {
    const n = Number(mali[1]);
    // The three-digit names (2021 on) are their own scale: G610/G615 (Dimensity 7-8 series) and G7xx draw it; G310 and
    // G510 are budget chips.
    if (n >= 100) return n >= 610;
    // The two-digit names (2016-2020): the G76, G77 and G78 are flagship chips (Exynos 9820 to 2100 in the Galaxy S10
    // to S21, Kirin 980 to 9000, Google Tensor in the Pixel 6), unless the name says a small build of it (MediaTek's
    // "Mali-G76 MC4" in the Helio G90T/G95: under 7 cores); the G71/G72 (2016-17) and the G5x/G68 are older or budget.
    if (n >= 76 && n <= 79) return mali[2] ? Number(mali[2]) >= 7 : true;
    return false;
  }
  if (/mali-?\s*t|powervr|adreno.*[345]\d\d\b/i.test(g)) return false;
  return null; // unknown
}

// info: { ua, maxTouchPoints, deviceMemory?, hardwareConcurrency?, gpu, screenW, screenH }
export function guessQuality(info = {}) {
  const ua = String(info.ua || '');
  const gpu = String(info.gpu || '');
  if (SOFTWARE.test(gpu)) return 'low';
  const mem = Number(info.deviceMemory) || 0; // Chrome only (rounded, at most 8)
  if (mem && mem <= 2) return 'low';
  const touch = (info.maxTouchPoints || 0) > 1;
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch);
  if (apple) return 'high'; // every iPhone from the last years draws it; the governor steps down if one cannot
  const phone = touch && (/Android|Mobile/i.test(ua) || Math.min(info.screenW || 0, info.screenH || 0) < 600);
  if (!phone) return 'high'; // computers (and big touch screens): the full look
  const strong = strongChip(gpu);
  if (strong === true) return 'high';
  if (strong === false) return 'low';
  return mem >= 6 ? 'high' : 'low';
}

// The governor's steps on a device whose frames come slowly while the visitor moves, in order, each taken once (main.js
// applies them through scene/roomEnvironment.js governorSteps): plain glass instead of refracting glass first (the
// shower glass as clear glass with the same reflection, the frosted window as its glow: three.js draws everything in
// view a second time for a refracting pane, and the change hardly shows); a little less sharpness; the live mirror at
// the weak device's setting (every other frame, a smaller picture: scene/mirrorReflection.js REFLECTION.low); the live
// mirror off only then, as the last mirror step (the doors show the room's photograph again: the owner asked for a real
// mirror, review 2026-10-20 finding 3); then less sharpness, twice.
export const GOVERNOR_STEPS = ['glass', 'sharpness', 'mirrorLow', 'mirror', 'sharpness', 'sharpness'];

// Feed it the time between two frames drawn one after the other (ms). When the middle value of the last stretch of
// busy drawing (at least windowMs of it, at least minFrames frames) is slower than slowMs, it returns the next step to
// apply (once), then waits for a fresh stretch. Pauses (the room sleeps when nothing moves) are not frames.
export function createFrameGovernor({ steps = [], slowMs = 40, windowMs = 2500, minFrames = 45, pauseMs = 250 } = {}) {
  let next = 0;
  let samples = [];
  let span = 0;
  return {
    frame(dtMs) {
      if (next >= steps.length) return null;
      if (!(dtMs > 0) || dtMs > pauseMs) return null;
      samples.push(dtMs);
      span += dtMs;
      if (samples.length < minFrames || span < windowMs) return null;
      const sorted = samples.slice().sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      samples = [];
      span = 0;
      if (median <= slowMs) return null;
      return steps[next++];
    },
    get level() { return next; },
  };
}
