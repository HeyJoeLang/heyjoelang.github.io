/*
    Where the game's camera sits. Its own module because two things need it:
    the game, and the Runner page, which flies its camera to this exact pose
    before handing the scene over so the cut between the two cannot be seen.
*/

import { clamp } from "../common.js";

export const GAME_CAMERA = {
    position: [0, 1.55, -3.6],
    target: [0, 1.15, 8]
};

// Holds the horizontal view on tall screens, or a phone in portrait would see
// so little of the wall that blocks arrive without warning.
export function gameFov(aspect)
{
    return aspect < 1 ? clamp(62 / aspect, 62, 95) : 62;
}
