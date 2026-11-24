// Plays the small preview drawings on the home page's project cards when a
// card scrolls into view, and again each time it comes back. The drawings are
// complete and still without this script or under reduced motion; the CSS
// animates only inside .preview.play.
(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const previews = document.querySelectorAll('.preview');
    if (!previews.length || !('IntersectionObserver' in window)) return;

    const ease = (t) => 1 - (1 - t) ** 3;
    function tween(ms, delay, step) {
        const start = performance.now() + delay;
        let id = 0;
        const frame = (now) => {
            const t = Math.min(Math.max((now - start) / ms, 0), 1);
            step(ease(t));
            if (t < 1) id = requestAnimationFrame(frame);
        };
        id = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(id);
    }

    function play(preview) {
        const stops = [];
        // Numbers run from data-from to data-to.
        preview.querySelectorAll('[data-to]').forEach((el) => {
            const from = Number(el.dataset.from);
            const to = Number(el.dataset.to);
            stops.push(tween(1300, 250, (t) => { el.textContent = Math.round(from + (to - from) * t); }));
        });
        // The search question types itself.
        const field = preview.querySelector('[data-type]');
        if (field) {
            const text = field.dataset.text || (field.dataset.text = field.textContent);
            field.textContent = '';
            stops.push(tween(1400, 200, (t) => { field.textContent = text.slice(0, Math.round(text.length * t)); }));
        }
        // The ball follows the arc as it is drawn.
        const arc = preview.querySelector('.pv-arc');
        const ball = preview.querySelector('.pv-ball');
        if (arc && ball) {
            const length = arc.getTotalLength();
            stops.push(tween(1200, 200, (t) => {
                const p = arc.getPointAtLength(length * t);
                ball.setAttribute('cx', p.x);
                ball.setAttribute('cy', p.y);
            }));
        }
        preview.classList.add('play');
        return () => stops.forEach((stop) => stop());
    }

    function reset(preview) {
        preview.classList.remove('play');
        preview.querySelectorAll('[data-to]').forEach((el) => { el.textContent = el.dataset.to; });
        const field = preview.querySelector('[data-type]');
        if (field && field.dataset.text) field.textContent = field.dataset.text;
    }

    const running = new Map();
    const seen = new IntersectionObserver((entries) => {
        for (const { target, isIntersecting } of entries) {
            if (isIntersecting && !running.has(target)) {
                running.set(target, play(target));
            } else if (!isIntersecting && running.has(target)) {
                running.get(target)();
                running.delete(target);
                reset(target);
            }
        }
    }, { threshold: 0.6 });
    previews.forEach((preview) => {
        preview.classList.add('animated');
        seen.observe(preview);
    });
})();
