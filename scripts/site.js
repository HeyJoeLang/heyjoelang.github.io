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

    if (toggle && mobileNav)
    {
        toggle.addEventListener("click", function ()
        {
            const isOpen = mobileNav.classList.toggle("open");
            toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        });

        mobileNav.querySelectorAll("a").forEach(function (link)
        {
            link.addEventListener("click", function ()
            {
                mobileNav.classList.remove("open");
                toggle.setAttribute("aria-expanded", "false");
            });
        });
    }

    /*
        Case-study cards are native <details>, which jump open/closed with no
        transition. Animate their height with the Web Animations API instead.
        Progressive enhancement: if this never runs, the browser's own toggle
        behavior still works, just without the tween.
    */
    initCaseCardAnimation();

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

    const observer = new IntersectionObserver(function (entries)
    {
        entries.forEach(function (entry)
        {
            if (entry.isIntersecting)
            {
                setActive(entry.target.id);
            }
        });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });

    sections.forEach(function (section) { observer.observe(section); });
});

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
