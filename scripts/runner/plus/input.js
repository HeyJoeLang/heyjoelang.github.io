/*
    Input: left/right steering from the keyboard or from holding either half
    of the play area, plus a single "go" action that starts and restarts.
*/

export function createInput(options)
{
    const surface = options.surface;

    const LEFT_KEYS = ["ArrowLeft", "a", "A"];
    const RIGHT_KEYS = ["ArrowRight", "d", "D"];
    const GO_KEYS = [" ", "Enter"];

    const keys = { left: false, right: false };

    // Pointers currently held, and which side each one is on.
    const pointers = new Map();

    function onKey(event, down)
    {
        const left = LEFT_KEYS.indexOf(event.key) !== -1;
        const right = RIGHT_KEYS.indexOf(event.key) !== -1;
        const go = GO_KEYS.indexOf(event.key) !== -1;

        if (!left && !right && !go) return;

        // Leave real controls alone: Space on the focused Start button is the
        // button's own click, and modified keys belong to the browser.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (go && event.target instanceof HTMLElement && event.target.closest("button, a")) return;

        // Otherwise these keys would scroll the page under the game.
        event.preventDefault();

        if (left) keys.left = down;
        if (right) keys.right = down;
        if (go && down && !event.repeat) options.onGo();
    }

    window.addEventListener("keydown", function (event) { onKey(event, true); });
    window.addEventListener("keyup", function (event) { onKey(event, false); });

    // A key held while the window loses focus never sends its keyup.
    window.addEventListener("blur", function ()
    {
        keys.left = false;
        keys.right = false;
        pointers.clear();
    });

    surface.addEventListener("pointerdown", function (event)
    {
        if (event.target instanceof HTMLElement && event.target.closest("button, a")) return;

        const box = surface.getBoundingClientRect();
        pointers.set(event.pointerId, event.clientX - box.left < box.width / 2 ? -1 : 1);

        options.onGo();
    });

    function release(event)
    {
        pointers.delete(event.pointerId);
    }

    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);

    return {
        // -1 left, +1 right, 0 neither (or both).
        steer: function ()
        {
            let direction = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);

            pointers.forEach(function (side) { direction += side; });

            return Math.max(-1, Math.min(1, direction));
        }
    };
}
