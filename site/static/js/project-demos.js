// The two live demos on /projects/: a shot from the FRC Shooter Selector and a
// search box over the FIRST Agentic CSA index. Both run entirely in the page —
// the maths and the ranking are ports of the projects' own code
// (shooter-physics.js, docs-search.js). Without JavaScript the demos stay
// hidden and the write-ups read as before.
import { DEFAULTS, EXIT_HEIGHT_M, FT, G, RIM_HEIGHT_M, solveShot } from './shooter-physics.js';
import { DocsSearch } from './docs-search.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ── Shooter ─────────────────────────────────────────────────────────────────

function shooterDemo(root) {
    const svg = root.querySelector('.shot-plot');
    const distance = root.querySelector('[name="distance"]');
    const angle = root.querySelector('[name="angle"]');
    const fire = root.querySelector('.shot-fire');
    const out = (name) => root.querySelector(`[data-out="${name}"]`);

    const exitFt = EXIT_HEIGHT_M / FT;
    const rimFt = RIM_HEIGHT_M / FT;
    const BACK = 2.4; // feet of floor shown behind the launch point, for the robot
    const SPAN = 22; // feet of floor shown in front of it
    const margin = { left: 38, right: 10, top: 10, bottom: 26 };

    let path = []; // the flight in feet, one point per 20 ms, ending at the rim
    let frame = 0;
    let px = (ft) => ft;
    let py = (ft) => ft;
    let ball = null;

    const placeBall = ([x, y]) => {
        ball.setAttribute('cx', px(x).toFixed(1));
        ball.setAttribute('cy', py(y).toFixed(1));
    };

    function draw() {
        cancelAnimationFrame(frame);
        const d = Number(distance.value);
        const a = Number(angle.value);
        const rad = (a * Math.PI) / 180;
        out('distance').textContent = `${d} ft`;
        out('angle').textContent = `${a}°`;

        const shot = solveShot(d, a);
        root.classList.toggle('no-shot', !shot.ok);
        fire.disabled = !shot.ok;

        // The flight, and the same launch with no air: it sails past the goal,
        // which is why the tool models drag.
        path = [[0, exitFt]];
        const noAir = [];
        let peak = [0, exitFt];
        if (shot.ok) {
            for (let i = 0; i < shot.cross.index; i++) path.push([shot.traj.x[i] / FT, shot.traj.y[i] / FT + exitFt]);
            path.push([shot.cross.x / FT, rimFt]);
            path.lastStep = shot.cross.frac; // the final segment is a part step
            for (const point of path) if (point[1] > peak[1]) peak = point;
            const vx = shot.v * Math.cos(rad);
            const vy = shot.v * Math.sin(rad);
            const landing = (vy + Math.sqrt(vy * vy + 2 * G * EXIT_HEIGHT_M)) / G;
            for (let i = 0; i <= 80; i++) {
                const t = (landing * i) / 80;
                noAir.push([(vx * t) / FT, (EXIT_HEIGHT_M + vy * t - 0.5 * G * t * t) / FT]);
            }
        }

        // The drawing is to scale, in real pixels. It fills the width, and pulls
        // back (narrowing, centred) only when a high lob would leave the top.
        const W = Math.max(svg.clientWidth, 280);
        const H = Math.round(W * (W < 520 ? 0.7 : 0.52));
        const fullW = W - margin.left - margin.right;
        const plotH = H - margin.top - margin.bottom;
        const scale = Math.min(fullW / (BACK + SPAN), plotH / (peak[1] + 1.6));
        const plotW = scale * (BACK + SPAN);
        const left = margin.left + (fullW - plotW) / 2;
        const right = left + plotW;
        const floor = H - margin.bottom;
        px = (ft) => left + scale * (ft + BACK);
        py = (ft) => floor - scale * ft;
        const points = (list) => list.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ');

        let grid = '';
        let labels = '';
        for (let ft = 0; ft <= SPAN; ft += 2) {
            grid += `<line x1="${px(ft)}" y1="${margin.top}" x2="${px(ft)}" y2="${floor}"/>`;
            if (ft % 4 === 0) labels += `<text x="${px(ft)}" y="${floor + 18}" text-anchor="middle">${ft === 0 ? '0' : `${ft} ft`}</text>`;
        }
        for (let ft = 2; py(ft) >= margin.top; ft += 2) {
            grid += `<line x1="${px(0)}" y1="${py(ft)}" x2="${right}" y2="${py(ft)}"/>`;
            if (ft % 4 === 0) labels += `<text x="${left - 8}" y="${py(ft) + 4}" text-anchor="end">${ft} ft</text>`;
        }

        const pivot = [-0.95 * Math.cos(rad), exitFt - 0.95 * Math.sin(rad)];
        const goal = `M ${px(d - 0.8)} ${py(rimFt)} L ${px(d - 0.4)} ${py(rimFt - 1)} L ${px(d + 0.4)} ${py(rimFt - 1)} L ${px(d + 0.8)} ${py(rimFt)}`;
        const peakLabel = shot.ok
            ? `<circle class="plot-peak" cx="${px(peak[0])}" cy="${py(peak[1])}" r="3"/>
               <text class="plot-note" x="${px(peak[0])}" y="${py(peak[1]) - 10}" text-anchor="middle">peak ${peak[1].toFixed(1)} ft</text>`
            : '';

        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.style.height = `${H}px`;
        svg.innerHTML = `
            <defs><clipPath id="shot-clip"><rect x="${left}" y="${margin.top}" width="${plotW}" height="${plotH}"/></clipPath></defs>
            <rect class="plot-area" x="${left}" y="${margin.top}" width="${plotW}" height="${plotH}"/>
            <g class="plot-grid">${grid}</g>
            <g class="plot-label">${labels}</g>
            <g clip-path="url(#shot-clip)">
                <polyline class="plot-vacuum" points="${points(noAir)}"/>
                <g class="plot-goal">
                    <line x1="${px(d)}" y1="${floor}" x2="${px(d)}" y2="${py(rimFt - 1)}"/>
                    <path d="${goal}"/>
                </g>
                <line class="plot-barrel" x1="${px(pivot[0])}" y1="${py(pivot[1])}" x2="${px(0)}" y2="${py(exitFt)}" stroke-width="${(scale * 0.42).toFixed(1)}"/>
                <rect class="plot-robot" x="${px(-2.1)}" y="${py(1.15)}" width="${scale * 2.3}" height="${scale * 0.85}" rx="2"/>
                <circle class="plot-wheel" cx="${px(-1.6)}" cy="${py(0.3)}" r="${scale * 0.3}"/>
                <circle class="plot-wheel" cx="${px(-0.3)}" cy="${py(0.3)}" r="${scale * 0.3}"/>
                <polyline class="plot-flight" points="${shot.ok ? points(path) : ''}"/>
                ${peakLabel}
                <circle class="plot-ball" r="${Math.max(5, (scale * 5.9) / 24).toFixed(1)}"/>
            </g>
            <line class="plot-floor" x1="${left}" y1="${floor}" x2="${right}" y2="${floor}"/>`;
        ball = svg.querySelector('.plot-ball');
        placeBall(path[path.length - 1]);

        if (!shot.ok) {
            for (const name of ['speed', 'rpm', 'entry', 'angle-miss', 'speed-miss']) out(name).textContent = '—';
            return;
        }
        out('speed').textContent = `${(shot.v / FT).toFixed(1)} ft/s`;
        out('rpm').textContent = `${Math.round(shot.rpm / 10) * 10} RPM`;
        out('entry').textContent = `${Math.abs(shot.entryAngle).toFixed(0)}° down`;
        out('angle-miss').textContent = `${(shot.dxda * 39.37).toFixed(1)} in`;
        out('speed-miss').textContent = `${(shot.dxdv * 12).toFixed(1)} in`;
    }

    // Fly the ball along the path in real time: one sample is 20 ms of flight.
    function shoot() {
        cancelAnimationFrame(frame);
        if (reducedMotion.matches || path.length < 2) return;
        const segments = path.length - 1;
        const duration = (segments - 1 + path.lastStep) * 20;
        const start = performance.now();
        const step = (now) => {
            // A frame's timestamp can be a shade earlier than the click that started it.
            const elapsed = Math.min(Math.max(now - start, 0), duration);
            const i = Math.min(Math.floor(elapsed / 20), segments - 1);
            let f = elapsed / 20 - i;
            if (i === segments - 1) f = Math.min(f / path.lastStep, 1);
            const [x0, y0] = path[i];
            const [x1, y1] = path[i + 1];
            placeBall([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
            if (elapsed < duration) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
    }

    distance.addEventListener('input', draw);
    angle.addEventListener('input', draw);
    fire.addEventListener('click', shoot);
    out('setup').textContent =
        `${DEFAULTS.wheelDiameterIn} in wheels, slip factor ${DEFAULTS.slipFactor}, drag coefficient ${DEFAULTS.dragCoefficient.toFixed(2)}`;
    root.hidden = false; // shown first: the drawing is sized from its width on the page
    draw();
    let width = svg.clientWidth;
    new ResizeObserver(() => {
        if (svg.clientWidth !== width) {
            width = svg.clientWidth;
            draw();
        }
    }).observe(svg);
}

// ── Docs search ─────────────────────────────────────────────────────────────

function docsDemo(root) {
    const form = root.querySelector('form');
    const input = root.querySelector('[name="q"]');
    const vendor = root.querySelector('[name="vendor"]');
    const status = root.querySelector('.docs-status');
    const list = root.querySelector('.docs-results');
    const SHOWN = 6;

    let search = null;
    let loading = null;
    let timer = 0;

    function load() {
        loading ??= fetch(root.dataset.index)
            .then((res) => {
                if (!res.ok) throw new Error(`index: ${res.status}`);
                return res.json();
            })
            .then((index) => {
                search = new DocsSearch(index);
                for (const v of search.vendors) vendor.append(new Option(`${v.name} (${v.docs.length})`, v.id));
                return search;
            });
        return loading;
    }

    function idle() {
        list.replaceChildren();
        status.textContent = search
            ? `${search.pageCount} pages from ${search.vendors.length} documentation sites, indexed ${search.builtAt}.`
            : '';
    }

    async function run() {
        const query = input.value.trim();
        if (!search) status.textContent = 'Loading the index…';
        try {
            await load();
        } catch {
            loading = null;
            status.textContent = 'The index did not load. Check your connection and try again.';
            return;
        }
        if (query !== input.value.trim()) return; // typed on while the index loaded
        if (!query) return idle();

        // The index holds some pages under two addresses; show each page once.
        const seen = new Set();
        const results = search
            .search(query, { vendor: vendor.value, maxResults: 10 })
            .filter((r) => {
                const key = `${r.title}\n${r.url.split(/[?#]/)[0]}`;
                return !seen.has(key) && seen.add(key);
            })
            .slice(0, SHOWN);

        list.replaceChildren(
            ...results.map((r) => {
                const item = document.createElement('li');
                const link = document.createElement('a');
                link.href = r.url;
                link.target = '_blank';
                link.rel = 'noreferrer';
                link.textContent = r.title;
                const source = document.createElement('span');
                source.className = 'docs-source';
                source.textContent = r.section === 'General' ? r.vendor : `${r.vendor} · ${r.section}`;
                const excerpt = document.createElement('p');
                excerpt.textContent = r.preview;
                item.append(link, source, excerpt);
                return item;
            }),
        );
        status.textContent = results.length
            ? `Top ${results.length} for “${query}”`
            : `Nothing in the index matches “${query}”. Try a part name or a concept, such as “TalonFX” or “odometry”.`;
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        clearTimeout(timer);
        run();
    });
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(run, 180);
    });
    input.addEventListener('focus', () => load().then(() => input.value.trim() || idle(), () => {}), { once: true });
    vendor.addEventListener('change', run);
    for (const example of root.querySelectorAll('.docs-example')) {
        example.addEventListener('click', () => {
            input.value = example.textContent;
            run();
        });
    }
    root.hidden = false;
}

for (const root of document.querySelectorAll('[data-demo="shooter"]')) shooterDemo(root);
for (const root of document.querySelectorAll('[data-demo="docs"]')) docsDemo(root);
