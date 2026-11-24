// One write-up at a time on /projects/. The index picks which one shows; an
// address like /projects/#pcb-agent (or #auto-xo, inside a write-up) opens it.
// Without this script every write-up shows, one after another.
//
// Loaded after lens.js: the index follows the write-ups' lens order, and a
// lens that leaves the open write-up out moves to the first one it keeps.
(() => {
    const root = document.querySelector('.projects');
    if (!root) return;
    const writeups = () => [...root.querySelectorAll('.writeup')];
    const list = root.querySelector('.index ul');
    const items = [...list.children];
    const target = (item) => item.querySelector('a').hash.slice(1);
    const titleOf = (writeup) => writeup.querySelector('h2').textContent.trim();
    let current = null;

    // Index rows for one write-up: its own row, then rows for anchors inside it.
    const rowsFor = (writeup) => items.filter((item) => {
        const el = document.getElementById(target(item));
        return el && el.closest('.writeup') === writeup;
    });

    function syncIndex() {
        for (const writeup of writeups()) {
            for (const row of rowsFor(writeup)) {
                row.classList.toggle('lens-off', writeup.classList.contains('lens-off'));
                list.appendChild(row);
            }
        }
    }

    function pager(writeup) {
        root.querySelectorAll('.pager').forEach((old) => old.remove());
        const all = writeups();
        const i = all.indexOf(writeup);
        const nav = document.createElement('nav');
        nav.className = 'pager';
        nav.setAttribute('aria-label', 'More projects');
        const link = (other, label, cls) => {
            if (!other) return;
            const a = document.createElement('a');
            a.href = `#${other.id}`;
            a.className = cls;
            a.innerHTML = `<small>${label}</small>`;
            a.append(titleOf(other));
            nav.appendChild(a);
        };
        link(all[i - 1], 'Previous', 'pager-prev');
        link(all[i + 1], 'Next', 'pager-next');
        writeup.appendChild(nav);
    }

    function show(writeup) {
        current = writeup;
        for (const w of writeups()) w.classList.toggle('is-current', w === writeup);
        for (const item of items) {
            const a = item.querySelector('a');
            if (rowsFor(writeup)[0] === item) {
                a.setAttribute('aria-current', 'true');
                // On a phone the index is a sideways strip: bring the open tab into it.
                const strip = list.parentElement;
                if (strip.scrollWidth > strip.clientWidth) strip.scrollLeft = item.offsetLeft - 20;
            }
            else a.removeAttribute('aria-current');
        }
        pager(writeup);
    }

    function fromHash(scroll) {
        const el = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
        const writeup = el && el.closest('.writeup');
        if (!writeup) return false;
        show(writeup);
        // Back to the top of the write-up (or the anchor inside it), not wherever the last one ended.
        if (scroll) (el === writeup ? root : el).scrollIntoView({ block: 'start' });
        return true;
    }

    root.classList.add('tabbed');
    syncIndex();
    if (!fromHash(false)) show(writeups()[0]);
    window.addEventListener('hashchange', () => fromHash(true));

    // A lens reorders the write-ups (lens.js); follow it.
    document.querySelectorAll('[data-lens-value]').forEach((chip) => chip.addEventListener('click', () => {
        syncIndex();
        if (current.classList.contains('lens-off') || !location.hash) {
            show(writeups().find((w) => !w.classList.contains('lens-off')) || writeups()[0]);
        } else {
            pager(current);
        }
    }));
})();
