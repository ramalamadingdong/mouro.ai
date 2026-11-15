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

    // Plot space: 20 px to the foot, the launch point 30 px in, the floor 24 px up.
    const W = 480;
    const H = 510;
    const S = 20;
    const px = (ft) => 30 + S * ft;
    const py = (ft) => H - 24 - S * ft;
    const exitFt = EXIT_HEIGHT_M / FT;
    const rimFt = RIM_HEIGHT_M / FT;
    const points = (list) => list.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ');

    let path = []; // the flight in feet, one point per 20 ms, ending at the rim
    let frame = 0;

    const ticks = [4, 8, 12, 16, 20]
        .map((ft) => `<line class="plot-tick" x1="${px(ft)}" y1="${py(0)}" x2="${px(ft)}" y2="${py(0) + 5}"/>
            <text class="plot-label" x="${px(ft)}" y="${py(0) + 18}" text-anchor="middle">${ft} ft</text>`)
        .join('');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
        <line class="plot-floor" x1="0" y1="${py(0)}" x2="${W}" y2="${py(0)}"/>
        ${ticks}
        <rect class="plot-robot" x="${px(-1.3)}" y="${py(exitFt - 0.35)}" width="${S * 1.3}" height="${S * (exitFt - 0.35)}"/>
        <line class="plot-barrel" x1="${px(0)}" y1="${py(exitFt)}" x2="${px(0)}" y2="${py(exitFt)}"/>
        <g class="plot-target">
            <line x1="0" y1="${py(0)}" x2="0" y2="${py(rimFt - 0.9)}"/>
            <path d="M ${-S * 0.7} ${py(rimFt)} L ${-S * 0.35} ${py(rimFt - 0.9)} L ${S * 0.35} ${py(rimFt - 0.9)} L ${S * 0.7} ${py(rimFt)}"/>
        </g>
        <polyline class="plot-vacuum" points=""/>
        <polyline class="plot-flight" points=""/>
        <circle class="plot-ball" r="${(S * 5.9) / 24}" cx="0" cy="0"/>`;
    const barrel = svg.querySelector('.plot-barrel');
    const target = svg.querySelector('.plot-target');
    const vacuum = svg.querySelector('.plot-vacuum');
    const flight = svg.querySelector('.plot-flight');
    const ball = svg.querySelector('.plot-ball');

    const placeBall = ([x, y]) => {
        ball.setAttribute('cx', px(x).toFixed(1));
        ball.setAttribute('cy', py(y).toFixed(1));
    };

    function draw() {
        cancelAnimationFrame(frame);
        const d = Number(distance.value);
        const a = Number(angle.value);
        out('distance').textContent = `${d} ft`;
        out('angle').textContent = `${a}°`;

        const shot = solveShot(d, a);
        root.classList.toggle('no-shot', !shot.ok);
        fire.disabled = !shot.ok;
        const rad = (a * Math.PI) / 180;
        barrel.setAttribute('x2', (px(0) + 22 * Math.cos(rad)).toFixed(1));
        barrel.setAttribute('y2', (py(exitFt) - 22 * Math.sin(rad)).toFixed(1));
        target.setAttribute('transform', `translate(${px(d)} 0)`);
        if (!shot.ok) {
            for (const name of ['speed', 'rpm', 'entry', 'angle-miss', 'speed-miss']) out(name).textContent = '—';
            flight.setAttribute('points', '');
            vacuum.setAttribute('points', '');
            return;
        }

        path = [[0, exitFt]];
        for (let i = 0; i < shot.cross.index; i++) path.push([shot.traj.x[i] / FT, shot.traj.y[i] / FT + exitFt]);
        path.push([shot.cross.x / FT, rimFt]);
        path.lastStep = shot.cross.frac; // the final segment is a part step
        flight.setAttribute('points', points(path));

        // The same launch with no air: it sails past, which is why drag is modelled.
        const noAir = [];
        const vx = shot.v * Math.cos(rad);
        const vy = shot.v * Math.sin(rad);
        const landing = (vy + Math.sqrt(vy * vy + 2 * G * EXIT_HEIGHT_M)) / G;
        for (let i = 0; i <= 60; i++) {
            const t = (landing * i) / 60;
            noAir.push([(vx * t) / FT, (EXIT_HEIGHT_M + vy * t - 0.5 * G * t * t) / FT]);
        }
        vacuum.setAttribute('points', points(noAir));
        placeBall(path[path.length - 1]);

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
            const elapsed = Math.min(now - start, duration);
            let i = Math.min(Math.floor(elapsed / 20), segments - 1);
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
    draw();
    root.hidden = false;
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
