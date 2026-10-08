/*
    HUD: the score readouts and the overlay shown before a run and after one.
    Also owns the best score, which is kept in the browser.
*/

const STORAGE_KEY = "runnerPlusBest";

export function createHud(options)
{
    const scoreEl = document.getElementById("rp-score");
    const bestEl = document.getElementById("rp-best");
    const overlay = document.getElementById("rp-overlay");
    const titleEl = document.getElementById("rp-title");
    const messageEl = document.getElementById("rp-message");
    const button = document.getElementById("rp-start");

    let best = 0;
    let shown = -1;

    try { best = Number(localStorage.getItem(STORAGE_KEY)) || 0; }
    catch (e) { /* storage blocked: the best score just lasts for this visit */ }

    bestEl.textContent = best + " m";

    button.addEventListener("click", options.onGo);

    const toastEl = document.getElementById("rp-toast");

    return {
        // A milestone callout: big, brief, and out of the way of the track.
        toast: function (text)
        {
            toastEl.textContent = text;

            // Removing and re-adding the class in one style pass would not
            // restart the animation; the read in between forces two passes.
            toastEl.classList.remove("is-showing");
            void toastEl.offsetWidth;
            toastEl.classList.add("is-showing");
        },

        setScore: function (metres)
        {
            // Only touch the DOM when the whole-metre figure changes.
            if (metres === shown) return;

            shown = metres;
            scoreEl.textContent = metres + " m";
        },

        showReady: function ()
        {
            titleEl.textContent = "Runner+";
            messageEl.textContent = "Run the inside of the tunnel and stay clear of the blocks.";
            button.textContent = "Start";
            button.disabled = false;
            overlay.hidden = false;
        },

        showFailed: function ()
        {
            titleEl.textContent = "Runner+";
            messageEl.textContent = "The 3D scene could not be loaded in this browser.";
            button.hidden = true;
            overlay.hidden = false;
        },

        hide: function ()
        {
            overlay.hidden = true;
        },

        showOver: function (metres)
        {
            const isBest = metres > best;

            if (isBest)
            {
                best = metres;
                bestEl.textContent = best + " m";

                try { localStorage.setItem(STORAGE_KEY, String(best)); }
                catch (e) { /* see above */ }
            }

            titleEl.textContent = metres + " m";
            messageEl.textContent = isBest ? "New best." : "Best so far: " + best + " m.";
            button.textContent = "Run again";
            overlay.hidden = false;

            // So Enter or Space restarts without reaching for the mouse.
            button.focus({ preventScroll: true });
        }
    };
}
