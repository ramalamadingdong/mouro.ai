// Motion for the home page: a pointer-aware node network behind the hero, a
// detection box that locks onto the portrait, the name assembling, sections
// revealing on scroll, counters, and a spotlight on the work cards.
//
// Everything here is decoration. With reduced motion, or without this script,
// the page is complete and still; CSS animates only under html.motion.
(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const root = document.documentElement;
    root.classList.add('motion');

    // ── Name: letters rise in one after another ───────────────────────────
    const name = document.querySelector('.hero .name');
    if (name) {
        const text = name.textContent;
        name.textContent = '';
        [...text].forEach((ch, i) => {
            const span = document.createElement('span');
            span.className = 'ch';
            span.setAttribute('aria-hidden', 'true');
            span.style.setProperty('--i', i);
            span.textContent = ch === ' ' ? ' ' : ch;
            name.appendChild(span);
        });
    }

    // ── Detection box: confidence ticks up as it locks on ─────────────────
    const score = document.querySelector('.detect-label b');
    if (score) {
        const start = performance.now() + 900;
        const tick = (now) => {
            const t = Math.min(Math.max((now - start) / 700, 0), 1);
            score.textContent = (0.42 + 0.56 * (1 - (1 - t) ** 3)).toFixed(2);
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    // ── Reveal on scroll, with counters ───────────────────────────────────
    const groups = [
        ['.page > .section, .lens-group > .section, .band, .footer', 0],
        ['.work-item', 70],
        ['.event', 35],
        ['.now-list li', 50],
    ];
    const reveal = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('in');
            entry.target.querySelectorAll('[data-count]').forEach(count);
            reveal.unobserve(entry.target);
        }
    }, { rootMargin: '0px 0px -6% 0px' });
    for (const [selector, step] of groups) {
        document.querySelectorAll(selector).forEach((el) => {
            const i = [...el.parentNode.children].indexOf(el);
            el.classList.add('reveal');
            el.style.setProperty('--d', `${Math.min(i, 8) * step}ms`);
            reveal.observe(el);
        });
    }

    function count(el) {
        const to = Number(el.dataset.count);
        const start = performance.now();
        const step = (now) => {
            const t = Math.min((now - start) / 1200, 1);
            el.textContent = Math.round(to * (1 - (1 - t) ** 3));
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    // ── Work cards: a spotlight and a slight tilt under the pointer ───────
    if (matchMedia('(hover: hover)').matches) {
        document.querySelectorAll('.work-item').forEach((card) => {
            card.addEventListener('pointermove', (e) => {
                const r = card.getBoundingClientRect();
                const x = (e.clientX - r.left) / r.width;
                const y = (e.clientY - r.top) / r.height;
                card.style.setProperty('--mx', `${x * 100}%`);
                card.style.setProperty('--my', `${y * 100}%`);
                card.style.setProperty('--rx', `${(0.5 - y) * 4}deg`);
                card.style.setProperty('--ry', `${(x - 0.5) * 4}deg`);
            });
            card.addEventListener('pointerleave', () => {
                card.style.setProperty('--rx', '0deg');
                card.style.setProperty('--ry', '0deg');
            });
        });
    }

    // ── Hero network ─────────────────────────────────────────────────────
    const canvas = document.querySelector('.hero-net');
    const hero = document.querySelector('.hero');
    if (!canvas || !hero) return;
    const ctx = canvas.getContext('2d');
    const pointer = { x: -1e4, y: -1e4 };
    let nodes = [];
    let w = 0;
    let h = 0;
    let running = false;
    let colors = {};

    function readColors() {
        const css = getComputedStyle(root);
        colors = { line: css.getPropertyValue('--steel').trim(), hot: css.getPropertyValue('--yellow').trim() };
    }

    function size() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const r = canvas.getBoundingClientRect();
        w = r.width;
        h = r.height;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const n = Math.round(Math.min(90, (w * h) / 14000));
        nodes = Array.from({ length: n }, () => ({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.25,
            vy: (Math.random() - 0.5) * 0.25,
            r: 1 + Math.random() * 1.6,
        }));
    }

    const LINK = 130;
    const REACH = 170;
    function frame() {
        if (!running) return;
        ctx.clearRect(0, 0, w, h);
        for (const n of nodes) {
            // Drift, wrap at the edges, and lean gently toward the pointer.
            const dx = pointer.x - n.x;
            const dy = pointer.y - n.y;
            const d = Math.hypot(dx, dy);
            if (d < REACH && d > 1) {
                n.vx += (dx / d) * 0.012;
                n.vy += (dy / d) * 0.012;
            }
            n.vx *= 0.985;
            n.vy *= 0.985;
            if (Math.hypot(n.vx, n.vy) < 0.08) {
                n.vx += (Math.random() - 0.5) * 0.05;
                n.vy += (Math.random() - 0.5) * 0.05;
            }
            n.x = (n.x + n.vx + w) % w;
            n.y = (n.y + n.vy + h) % h;
            n.hot = d < REACH;
        }
        ctx.lineWidth = 1;
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d > LINK) continue;
                ctx.globalAlpha = (1 - d / LINK) * (a.hot && b.hot ? 0.75 : 0.28);
                ctx.strokeStyle = a.hot && b.hot ? colors.hot : colors.line;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
            if (a.hot) {
                const d = Math.hypot(a.x - pointer.x, a.y - pointer.y);
                ctx.globalAlpha = (1 - d / REACH) * 0.6;
                ctx.strokeStyle = colors.hot;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(pointer.x, pointer.y);
                ctx.stroke();
            }
        }
        for (const n of nodes) {
            ctx.globalAlpha = n.hot ? 1 : 0.55;
            ctx.fillStyle = n.hot ? colors.hot : colors.line;
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.hot ? n.r + 1 : n.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        requestAnimationFrame(frame);
    }

    function setRunning(on) {
        if (on === running) return;
        running = on;
        if (on) requestAnimationFrame(frame);
    }

    readColors();
    size();
    let visible = true;
    new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        setRunning(visible && !document.hidden);
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => setRunning(visible && !document.hidden));
    new ResizeObserver(() => size()).observe(canvas);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
    window.addEventListener('pointermove', (e) => {
        const r = canvas.getBoundingClientRect();
        pointer.x = e.clientX - r.left;
        pointer.y = e.clientY - r.top;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { pointer.x = pointer.y = -1e4; });
})();
