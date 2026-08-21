/*
    Nav behavior for the single-page layout: mobile menu toggle
    and scroll-spy highlighting of the active section link.
    No fetch — all section content already lives in the page HTML.
*/

document.addEventListener("DOMContentLoaded", function ()
{
    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    const toggle = document.getElementById("nav-toggle");
    const mobileNav = document.getElementById("mobile-nav");

    if (toggle && mobileNav) initMobileNav(toggle, mobileNav);

    /*
        Case-study cards are native <details>, which jump open/closed with no
        transition. Animate their height with the Web Animations API instead.
        Progressive enhancement: if this never runs, the browser's own toggle
        behavior still works, just without the tween.
    */
    initCaseCardAnimation();

    /*
        Collapsed cards look like plain headings, so visitors miss that there's
        a case study behind each one. Nudge the +/- marker as a group scrolls
        into view — see the "Expand affordance" block in site.css.
    */
    initCaseCardHints();

    const sections = Array.from(document.querySelectorAll("main section[id]"));
    const navLinks = Array.from(document.querySelectorAll(".nav-links a, #mobile-nav a"));

    if (!sections.length || !navLinks.length) return;

    function setActive(id)
    {
        navLinks.forEach(function (link)
        {
            link.classList.toggle("active", link.getAttribute("href") === "#" + id);
        });
    }

    /*
        The root margin leaves a narrow band across the middle of the viewport.
        More than one section can straddle it at once, and entry order is not
        document order — so rather than letting whichever entry happens to come
        last win (which made the highlight flicker between two links), track how
        much of the band each section fills and pick the leader outright.
    */
    const filled = new Map();

    const observer = new IntersectionObserver(function (entries)
    {
        entries.forEach(function (entry)
        {
            if (entry.isIntersecting) filled.set(entry.target, entry.intersectionRect.height);
            else filled.delete(entry.target);
        });

        let winner = null;
        let mostFilled = 0;

        // Walk in document order so a tie resolves to the higher section.
        sections.forEach(function (section)
        {
            const height = filled.get(section);
            if (height === undefined || height <= mostFilled) return;

            winner = section;
            mostFilled = height;
        });

        if (winner) setActive(winner.id);
    }, { rootMargin: "-45% 0px -50% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] });

    sections.forEach(function (section) { observer.observe(section); });
});

/*
    The mobile menu used to snap between display:none and display:block. Tween
    its height instead, the same way the case cards do. Falls back to the
    instant toggle where Web Animations is missing or motion is unwelcome.
*/
function initMobileNav(toggle, nav)
{
    const DURATION = 240;
    const EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

    const canAnimate = typeof Element.prototype.animate === "function"
        && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let animation = null;
    let isOpen = false;

    function setOpen(next)
    {
        if (next === isOpen) return;

        isOpen = next;
        toggle.setAttribute("aria-expanded", next ? "true" : "false");

        if (!canAnimate)
        {
            nav.classList.toggle("open", next);
            return;
        }

        // Read the current height before cancelling, so reversing mid-tween
        // starts from where the panel actually is rather than snapping.
        const from = nav.classList.contains("open") ? nav.offsetHeight : 0;
        if (animation) animation.cancel();

        // Lay the panel out so its content height can be measured.
        nav.classList.add("open");
        nav.style.overflow = "hidden";
        nav.style.height = from + "px";

        const to = next ? nav.scrollHeight : 0;

        animation = nav.animate(
            { height: [from + "px", to + "px"] },
            { duration: DURATION, easing: EASING }
        );

        animation.onfinish = function ()
        {
            if (!next) nav.classList.remove("open");
            nav.style.height = "";
            nav.style.overflow = "";
            animation = null;
        };
    }

    toggle.addEventListener("click", function () { setOpen(!isOpen); });

    nav.querySelectorAll("a").forEach(function (link)
    {
        link.addEventListener("click", function () { setOpen(false); });
    });
}

function initCaseCardAnimation()
{
    const cards = Array.from(document.querySelectorAll("details.case-card"));
    if (!cards.length) return;

    // No Web Animations support, or the visitor asked for less motion: leave
    // the native instant toggle alone.
    if (typeof Element.prototype.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const DURATION = 280;
    const EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

    cards.forEach(function (card)
    {
        const summary = card.querySelector("summary");
        if (!summary) return;

        let animation = null;
        let isClosing = false;
        let isExpanding = false;

        summary.addEventListener("click", function (event)
        {
            // Drive the state change ourselves so we can tween through it.
            event.preventDefault();

            if (isClosing || !card.open) startOpen();
            else if (isExpanding || card.open) startClose();
        });

        function startOpen()
        {
            card.classList.remove("is-closing");
            isClosing = false;

            // Lock in the collapsed height, then reveal the content so we can
            // measure where we're animating to.
            card.style.height = card.offsetHeight + "px";
            card.open = true;
            window.requestAnimationFrame(expand);
        }

        function expand()
        {
            isExpanding = true;

            const start = card.offsetHeight;
            const end = card.scrollHeight;

            if (animation) animation.cancel();

            animation = card.animate(
                { height: [start + "px", end + "px"] },
                { duration: DURATION, easing: EASING }
            );

            animation.onfinish = function () { settle(true); };
            animation.oncancel = function () { isExpanding = false; };
        }

        function startClose()
        {
            isClosing = true;

            // Flip the +/- marker immediately rather than at animation end.
            card.classList.add("is-closing");

            const start = card.offsetHeight;
            const end = summary.offsetHeight;

            if (animation) animation.cancel();

            animation = card.animate(
                { height: [start + "px", end + "px"] },
                { duration: DURATION, easing: EASING }
            );

            animation.onfinish = function () { settle(false); };
            animation.oncancel = function () { isClosing = false; };
        }

        function settle(isOpen)
        {
            card.open = isOpen;
            card.classList.remove("is-closing");
            card.style.height = "";
            animation = null;
            isClosing = false;
            isExpanding = false;
        }
    });
}

function initCaseCardHints()
{
    const cards = Array.from(document.querySelectorAll("details.case-card"));
    if (!cards.length) return;

    if (typeof IntersectionObserver !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Once the visitor opens anything they've understood the pattern, so every
    // remaining hint is just noise. Hover and focus styling carries on.
    let retired = false;

    const observer = new IntersectionObserver(function (entries)
    {
        // Cards in one viewport arrive in a single callback, so index within
        // the batch to stagger them rather than firing thirteen at once.
        let position = 0;

        entries.forEach(function (entry)
        {
            if (!entry.isIntersecting) return;

            observer.unobserve(entry.target);
            if (retired) return;

            const card = entry.target;
            card.style.setProperty("--hint-delay", (position * 0.11).toFixed(2) + "s");
            card.classList.add("hint-nudge");
            position += 1;
        });
    }, { threshold: 0.9 });

    cards.forEach(function (card)
    {
        observer.observe(card);
        card.addEventListener("toggle", retireHints);

        // Drop the class once the animation is done so a later hover or an
        // open/close never fights a lingering animated transform.
        card.addEventListener("animationend", function (event)
        {
            if (event.animationName === "case-hint-nudge") card.classList.remove("hint-nudge");
        });
    });

    function retireHints()
    {
        if (retired) return;
        retired = true;

        observer.disconnect();
        cards.forEach(function (card) { card.classList.remove("hint-nudge"); });
    }
}
