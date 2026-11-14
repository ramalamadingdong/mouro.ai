// Fade sections in as they scroll into view. The page is fully readable without
// this: the hidden state only applies under `.js` (set inline in <head>) and
// when the visitor has not asked for reduced motion.
(() => {
    const targets = document.querySelectorAll("[data-reveal]");
    const show = (el) => el.classList.add("is-visible");

    if (!("IntersectionObserver" in window)) {
        targets.forEach(show);
        return;
    }

    // rootMargin rather than a ratio threshold, so sections taller than the
    // viewport (long write-ups on a phone) still reveal.
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    show(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        },
        { rootMargin: "0px 0px -8% 0px" }
    );
    targets.forEach((target) => observer.observe(target));
})();
