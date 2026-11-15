// Ballistics for the shooter demo on /projects/.
//
// A straight port of shooter/physics.py in
// https://github.com/ramalamadingdong/frc-shooter-selector — same constants,
// same integrator, same search — so the numbers on the page are the numbers
// the tool gives. Keep the two in step if the Python changes.

export const G = 9.81; // m/s^2
export const BALL_DIAMETER_IN = 5.9;
const BALL_RADIUS_M = (BALL_DIAMETER_IN * 0.0254) / 2;
const BALL_MASS_KG = 0.5 * 0.453592;
const BALL_CROSS_SECTION = Math.PI * BALL_RADIUS_M ** 2;
const AIR_DENSITY = 1.2; // kg/m^3

export const RIM_HEIGHT_M = 72 * 0.0254;
export const EXIT_HEIGHT_M = 20 * 0.0254;
export const DELTA_Y = RIM_HEIGHT_M - EXIT_HEIGHT_M;

// The tool's defaults (get_default_config in physics.py).
export const DEFAULTS = {
    dragCoefficient: 0.5,
    slipFactor: 1.15,
    wheelDiameterIn: 4.0,
};

export const FT = 0.3048;

/** Flight path with quadratic air drag. Samples every 20 ms, as the tool does. */
export function simulateTrajectory(v0, angleDeg, dragCoeff, dt = 0.002) {
    const dragConstant = 0.5 * AIR_DENSITY * dragCoeff * BALL_CROSS_SECTION;
    const theta = (angleDeg * Math.PI) / 180;
    let x = 0;
    let y = 0;
    let vx = v0 * Math.cos(theta);
    let vy = v0 * Math.sin(theta);
    const xs = [];
    const ys = [];
    const vxs = [];
    const vys = [];
    let t = 0;
    const sampleInterval = 0.02;
    let nextSample = sampleInterval;

    while (t < 5.0 && y >= -EXIT_HEIGHT_M && x < 30) {
        const v = Math.sqrt(vx ** 2 + vy ** 2);
        let ax = 0;
        let ay = -G;
        if (v > 0) {
            const aDrag = (dragConstant * v ** 2) / BALL_MASS_KG;
            ax = (-aDrag * vx) / v;
            ay = -G - (aDrag * vy) / v;
        }
        // Smaller steps near rim height, where the crossing is measured.
        const step = Math.abs(y - DELTA_Y) < 0.5 ? dt * 0.5 : dt;
        vx += ax * step;
        vy += ay * step;
        x += vx * step;
        y += vy * step;
        t += step;
        if (t >= nextSample) {
            xs.push(x);
            ys.push(y);
            vxs.push(vx);
            vys.push(vy);
            nextSample += sampleInterval;
        }
    }
    return { x: xs, y: ys, vx: vxs, vy: vys };
}

/** Where the path comes down through rim height. */
export function findRimCrossing(traj) {
    const { x: xs, y: ys, vx: vxs, vy: vys } = traj;
    for (let i = 1; i < ys.length; i++) {
        if (ys[i - 1] >= DELTA_Y && ys[i] < DELTA_Y && vys[i] < 0) {
            const frac = (DELTA_Y - ys[i - 1]) / (ys[i] - ys[i - 1]);
            const x = xs[i - 1] + frac * (xs[i] - xs[i - 1]);
            const vy = vys[i - 1] + frac * (vys[i] - vys[i - 1]);
            const vx = vxs[i - 1] + frac * (vxs[i] - vxs[i - 1]);
            return { x, entryAngle: (Math.atan2(vy, vx) * 180) / Math.PI, valid: true, index: i, frac };
        }
    }
    return { x: Infinity, entryAngle: 0, valid: false, index: -1, frac: 0 };
}

/** Binary search for the exit speed that lands the ball at targetM. */
export function findRequiredVelocity(targetM, angleDeg, dragCoeff) {
    let vLow = 1.0;
    let vHigh = 50.0;
    const tolerance = 0.05;
    let bestV = null;
    let bestTraj = null;
    let bestError = Infinity;
    let vMid = 0;
    let traj = null;

    for (let i = 0; i < 20; i++) {
        vMid = (vLow + vHigh) / 2;
        traj = simulateTrajectory(vMid, angleDeg, dragCoeff);
        const cross = findRimCrossing(traj);
        if (!cross.valid) {
            vLow = vMid;
            continue;
        }
        const error = Math.abs(cross.x - targetM);
        if (error < bestError) {
            bestError = error;
            bestV = vMid;
            bestTraj = traj;
        }
        if (error < tolerance) return { v: vMid, traj };
        if (cross.x < targetM) vLow = vMid;
        else vHigh = vMid;
        if (vHigh - vLow < 0.05) break;
    }
    return { v: bestV ?? vMid, traj: bestTraj ?? traj };
}

/** How far the landing point moves per m/s of speed error and per degree of angle error. */
export function calcSensitivity(angleDeg, v0, dragCoeff) {
    const dv = 0.1;
    const da = 0.5;
    const land = (v, a) => findRimCrossing(simulateTrajectory(v, a, dragCoeff)).x;
    const xpv = land(v0 + dv, angleDeg);
    const xmv = land(v0 - dv, angleDeg);
    const xpa = land(v0, angleDeg + da);
    const xma = land(v0, angleDeg - da);
    const dxdv = xpv !== Infinity && xmv !== Infinity ? Math.abs((xpv - xmv) / (2 * dv)) : 10.0;
    const dxda = xpa !== Infinity && xma !== Infinity ? Math.abs((xpa - xma) / (2 * da)) : 10.0;
    return { dxdv, dxda };
}

/** Wheel speed for an exit speed, with the tool's slip factor and wheel size. */
export function wheelRpm(vExit, slipFactor = DEFAULTS.slipFactor, wheelDiameterIn = DEFAULTS.wheelDiameterIn) {
    const surfaceSpeed = vExit * slipFactor;
    return (surfaceSpeed / (Math.PI * wheelDiameterIn * 0.0254)) * 60;
}

/** One shot: everything the demo shows for a distance and a launch angle. */
export function solveShot(distanceFt, angleDeg, dragCoeff = DEFAULTS.dragCoefficient) {
    const { v, traj } = findRequiredVelocity(distanceFt * FT, angleDeg, dragCoeff);
    const cross = findRimCrossing(traj);
    const ok = cross.valid && v <= 40 && Math.abs(cross.x - distanceFt * FT) < 0.15;
    if (!ok) return { ok: false };
    const { dxdv, dxda } = calcSensitivity(angleDeg, v, dragCoeff);
    return {
        ok: true,
        v,
        traj,
        cross,
        rpm: wheelRpm(v),
        entryAngle: cross.entryAngle,
        dxdv,
        dxda,
    };
}
