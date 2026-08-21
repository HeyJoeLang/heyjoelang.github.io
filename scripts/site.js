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
        Light/dark switch. The theme itself is already applied by the inline
        script in the document head; this only wires the control up.
    */
    initThemeToggle();

    /*
        Case-study cards are native <details>, which jump open/closed with no
        transition. Animate their height with the Web Animations API instead.
        Progressive enhancement: if this never runs, the browser's own toggle
        behavior still works, just without the tween.
    */
    initCaseCardAnimation();

    /*
        Collapsed cards look like plain headings, so visitors miss that there's
        a case study behind each one. Run a cue across each group of cards as
        it arrives — see the "Cascade cue" block in site.css.
    */
    initCaseCardCascade();

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
    Theme switch.

    The head script has already put data-theme on <html>, so there is nothing
    to apply on load — this just reflects that state into the control and
    handles clicks. Storage is only written once the visitor actually picks a
    side; until then the OS preference stays in charge and keeps tracking.
*/
function initThemeToggle()
{
    const control = document.getElementById("theme-toggle");
    if (!control) return;

    const root = document.documentElement;

    function stored()
    {
        try { return localStorage.getItem("theme"); }
        catch (e) { return null; }
    }

    function apply(isDark, remember)
    {
        // Paint the swap rather than snapping it, but only for the switch
        // itself — a permanent global transition would be far too costly.
        root.classList.add("theme-switching");
        window.setTimeout(function () { root.classList.remove("theme-switching"); }, 320);

        root.setAttribute("data-theme", isDark ? "dark" : "light");
        control.setAttribute("aria-checked", isDark ? "true" : "false");

        if (remember)
        {
            try { localStorage.setItem("theme", isDark ? "dark" : "light"); }
            catch (e) { /* private mode: the choice just won't outlive the tab */ }
        }
    }

    // Reflect whatever the head script decided.
    control.setAttribute("aria-checked", root.getAttribute("data-theme") === "dark" ? "true" : "false");

    control.addEventListener("click", function ()
    {
        apply(root.getAttribute("data-theme") !== "dark", true);
    });

    // Keep following the OS, but only while the visitor has no stated opinion.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onOsChange = function (event) { if (!stored()) apply(event.matches, false); };

    if (typeof media.addEventListener === "function") media.addEventListener("change", onOsChange);
    else if (typeof media.addListener === "function") media.addListener(onOsChange);
}

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

/*
    Cascade cue.

    When a group of case cards scrolls into view, every card in that group gets
    the cue, staggered so neighbours overlap and it reads as one wave down the
    list. Fires once per group, and stops for good the moment the visitor opens
    anything — by then they know the cards open.
*/
function initCaseCardCascade()
{
    const cards = Array.from(document.querySelectorAll("details.case-card"));
    if (!cards.length) return;

    if (typeof IntersectionObserver !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Roughly the 0.85s pass divided by 2.5, so about two and a half cards are
    // ever in flight. At a 4:1 ratio a short group (Mursion has four cards
    // spanning 285px) had every card animating at once, which reads as one
    // fast flash rather than a wave.
    const STAGGER = 0.34;

    // The two case-study sections each hold their own run of cards, and each
    // should cascade when it arrives rather than both firing together. Group
    // by parent so this keeps working if a third section is added.
    const groups = new Map();

    cards.forEach(function (card)
    {
        const parent = card.parentElement;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push(card);
    });

    /*
        Watch each group's FIRST CARD, not the group container. Both containers
        open with a heading, a video and intro copy, so their top edge sits
        ~700px above their first card — observing the container fired the whole
        wave while it was still well below the fold. Keying off the first card
        means the wave starts exactly when the reader can see where it starts.
    */
    const leaders = new Map();
    const armed = new Map();

    groups.forEach(function (list)
    {
        leaders.set(list[0], list);
        armed.set(list[0], true);
    });

    const observer = new IntersectionObserver(function (entries)
    {
        entries.forEach(function (entry)
        {
            const leader = entry.target;

            /*
                Two thresholds give the re-fire some hysteresis: a group plays
                once its first card is properly in view, and only becomes
                eligible again after that card has left the viewport entirely.
                Firing and re-arming on the same boundary would let a few
                pixels of scroll jitter restart the wave continuously.
            */
            if (!entry.isIntersecting)
            {
                armed.set(leader, true);
                return;
            }

            if (entry.intersectionRatio < 0.85) return;
            if (!armed.get(leader)) return;

            armed.set(leader, false);
            play(leaders.get(leader) || []);
        });
    }, { threshold: [0, 0.85], rootMargin: "0px 0px -12% 0px" });

    leaders.forEach(function (_list, firstCard) { observer.observe(firstCard); });

    function play(list)
    {
        /*
            Clear the class off the whole group first. A card whose turn came
            while it was hovered never ran its animation, so animationend never
            fired and it still carries the class — re-adding it would be a
            no-op and that card would sit the wave out.
        */
        list.forEach(function (card) { card.classList.remove("cascade"); });

        // Force the removal to land before re-adding, or the browser coalesces
        // both mutations into one style pass and the animation never restarts.
        void list[0].offsetWidth;

        list.forEach(function (card, index)
        {
            card.style.setProperty("--cascade-delay", (index * STAGGER).toFixed(2) + "s");
            card.classList.add("cascade");
        });
    }

    // Drop the class once a card's pass is done, so a later hover or open/close
    // never fights a lingering animated transform.
    cards.forEach(function (card)
    {
        card.addEventListener("animationend", function (event)
        {
            if (event.animationName === "case-cascade-sweep") card.classList.remove("cascade");
        });
    });
}
