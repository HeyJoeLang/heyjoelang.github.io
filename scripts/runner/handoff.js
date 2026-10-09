/*
    The page half of the hand-off from Runner to Runner+.

    Pressing Play on the Runner page does not navigate. The scene keeps
    running, its camera flies round behind the runner, and the game starts in
    the same canvas. For that the Runner page needs the game's HUD, overlay
    and stylesheet, and rather than keep a second copy of that markup here it
    is lifted out of runnerPlus.html itself, which stays the one place it is
    written.

    Once the game is showing, the address bar is moved to runnerPlus.html so
    a reload or a shared link lands on the real page.
*/

// Root-absolute, like the links to it in runner.html: the Runner page is
// reachable as /runner, /runner.html or /runner/, and a relative path would
// resolve differently under the last of those.
const GAME_PAGE = "/runnerPlus.html";

// Fetches the game page and returns what the Runner page needs from it. The
// stylesheet is in place and loaded by the time this resolves.
export async function prepareGameDom()
{
    const response = await fetch(GAME_PAGE);
    if (!response.ok) throw new Error("Could not fetch " + GAME_PAGE);

    const page = new DOMParser().parseFromString(await response.text(), "text/html");

    const stage = page.getElementById("rp-stage");
    const sheet = page.querySelector('link[rel="stylesheet"][href*="runnerPlus.css"]');
    if (!stage || !sheet) throw new Error(GAME_PAGE + " is missing the stage or its stylesheet");

    await new Promise(function (resolve, reject)
    {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.getAttribute("href");
        link.addEventListener("load", resolve);
        link.addEventListener("error", function () { reject(new Error("Could not load " + link.href)); });
        document.head.appendChild(link);
    });

    const node = document.importNode(stage, true);

    // The game draws into the Runner page's canvas, not one of its own.
    const canvas = node.querySelector("canvas");
    if (canvas) canvas.remove();

    // Kept out of sight until the game says it is ready.
    const overlay = node.querySelector("#rp-overlay");
    if (overlay) overlay.hidden = true;

    return { stage: node, title: page.title };
}

// Swaps the Runner page's content for the game's and takes on its address.
export function showGameDom(dom)
{
    document.documentElement.classList.add("runner-handed-off");
    document.body.appendChild(dom.stage);

    document.querySelectorAll("#site-nav a, #mobile-nav a").forEach(function (link)
    {
        const isGame = link.getAttribute("href") === GAME_PAGE;

        link.classList.toggle("active", isGame);

        if (isGame) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });

    document.title = dom.title;
    window.history.pushState({ runnerHandoff: true }, "", GAME_PAGE);

    // Back means the Runner page again. Its scene has been dismantled, so
    // the honest way to show it is to load it.
    window.addEventListener("popstate", function () { window.location.reload(); });
}
