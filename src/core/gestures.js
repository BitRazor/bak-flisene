// One-finger gesture classifier: tap, hold, drag (object or camera). Pure: no DOM, no time source.
// Rule (concept v3 section 9): a drag that starts on a movable thing and goes along its own path
// works the thing; any other drag looks around. Times in ms, positions in CSS pixels.
// The target may say:
//   dragAxis [x, y]  its own path on the screen (a drawer, a lid): a drag along it works the thing;
//   free             any direction works it (wiping the fogged mirror) ...
//   freeDelay (ms)   ... but only after the finger rested that long first ("touch the glass, then rub"); a drag that
//                    moves at once looks around, so looking never turns into smearing by accident;
//   noHold           it has no hold of its own: a long still press stays a tap and a late move still drags (a hold
//                    would freeze the finger for nothing).

const COS45 = Math.SQRT1_2 - 1e-9;

export function createGestures({ slopPx = 10, holdMs = 450 } = {}) {
  let s = null;

  function down(t, x, y, target, slop = slopPx) {
    s = { t0: t, x0: x, y0: y, lx: x, ly: y, target, mode: 'pending', slop };
    return [];
  }

  function move(t, x, y) {
    if (!s) return [];
    if (s.mode === 'hold') return [];
    if (s.mode === 'pending') {
      const dx = x - s.x0;
      const dy = y - s.y0;
      const dist = Math.hypot(dx, dy);
      if (dist <= s.slop) return [];
      const axis = s.target && s.target.dragAxis;
      let kind = 'camera';
      if (s.target && s.target.free) kind = t - s.t0 >= (s.target.freeDelay || 0) ? 'object' : 'camera';
      else if (axis) {
        const cos = Math.abs((dx * axis[0] + dy * axis[1]) / dist);
        if (cos >= COS45) kind = 'object';
      }
      s.mode = kind;
      const evts = [{ type: 'dragStart', kind, target: s.target, x: s.x0, y: s.y0 }];
      evts.push(dragEvent(x, y));
      return evts;
    }
    return [dragEvent(x, y)];
  }

  function dragEvent(x, y) {
    const dx = x - s.lx;
    const dy = y - s.ly;
    s.lx = x;
    s.ly = y;
    const evt = { type: 'drag', kind: s.mode, target: s.target, dx, dy, x, y };
    if (s.mode === 'object' && s.target.dragAxis) {
      const [ax, ay] = s.target.dragAxis;
      evt.along = (x - s.x0) * ax + (y - s.y0) * ay;
    }
    return evt;
  }

  function tick(t) {
    if (!s || s.mode !== 'pending') return [];
    if (s.target && s.target.noHold) return [];
    if (t - s.t0 >= holdMs) {
      s.mode = 'hold';
      return [{ type: 'holdStart', target: s.target, x: s.x0, y: s.y0 }];
    }
    return [];
  }

  function up(t, x, y) {
    if (!s) return [];
    const st = s;
    s = null;
    if (st.mode === 'object' || st.mode === 'camera') return [{ type: 'dragEnd', kind: st.mode, target: st.target, x, y }];
    if (st.mode === 'hold') return [{ type: 'holdEnd', target: st.target, x, y }];
    return [{ type: 'tap', target: st.target, x: st.x0, y: st.y0 }];
  }

  function cancel() {
    s = null;
  }

  return { down, move, tick, up, cancel, active: () => s !== null, mode: () => (s ? s.mode : null) };
}
