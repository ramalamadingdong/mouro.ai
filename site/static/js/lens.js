// Interest lenses for / and /projects/. A lens reorders and highlights the
// cards that are already in the page; it never adds, removes or rewrites one.
//
//   data-lens="robotics devrel"     the lenses a card belongs to
//   data-lens-order-robotics="1"    its place among that lens's cards
//   data-lens-sub="robotics"        the hero line shown for that lens
//   data-lens-value="robotics"      a chip
//
// The choice lives in ?lens= only, and is carried on links between the two
// pages. Loaded as a plain script after the content so a ?lens= address is
// arranged before the first paint.
(() => {
    const chips = [...document.querySelectorAll('[data-lens-value]')];
    const cards = [...document.querySelectorAll('[data-lens]')];
    const known = chips.map((chip) => chip.dataset.lensValue);
    cards.forEach((card, i) => { card.dataset.lensIndex = i; });

    function apply(value) {
        const lens = known.includes(value) ? value : '';
        const rank = (card) => {
            if (!lens) return 0;
            if (!card.dataset.lens.split(' ').includes(lens)) return 1000;
            return Number(card.getAttribute(`data-lens-order-${lens}`)) || 500;
        };
        // Matching cards first, in their lens order; the rest keep the page's own order.
        for (const parent of new Set(cards.map((card) => card.parentNode))) {
            cards.filter((card) => card.parentNode === parent)
                .sort((a, b) => rank(a) - rank(b) || a.dataset.lensIndex - b.dataset.lensIndex)
                .forEach((card) => parent.appendChild(card));
        }
        cards.forEach((card) => card.classList.toggle('lens-off', rank(card) === 1000));
        chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.lensValue === lens)));
        document.querySelectorAll('[data-lens-sub]').forEach((line) => { line.hidden = line.dataset.lensSub !== lens; });
        // Carry the lens between Home and Projects.
        for (const link of document.querySelectorAll('a[href]')) {
            if (link.origin === location.origin && /^\/(projects\/)?$/.test(link.pathname)) link.href = withLens(link.href, lens);
        }
        return lens;
    }

    function withLens(address, lens) {
        const url = new URL(address);
        if (lens) url.searchParams.set('lens', lens);
        else url.searchParams.delete('lens');
        return url.href;
    }

    apply(new URLSearchParams(location.search).get('lens') || '');
    chips.forEach((chip) => chip.addEventListener('click', () => {
        history.replaceState(null, '', withLens(location.href, apply(chip.dataset.lensValue)));
    }));
    document.querySelectorAll('.lens').forEach((group) => { group.hidden = false; });
    document.documentElement.classList.remove('lens-pending');
})();
