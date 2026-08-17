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
