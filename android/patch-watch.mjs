/* Replaces the watch page's action row (lines 955..962, 1-based) with the
 * YouTube-style pill row. Done by line number rather than by exact-match so the
 * long inline SVG paths cannot drift out of the search string. */
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("./assets/index.html", import.meta.url);
const lines = readFileSync(path, "utf8").split("\n");

const start = 955 - 1;   // '<button ... id="likeBtn">'
const end   = 962;       // '</div>' closing the desc box (inclusive)

if (!/id="likeBtn"/.test(lines[start])) throw new Error("line " + 955 + " is not the like button");
if (!/id="descBox"/.test(lines[start + 4])) throw new Error("line 959 is not the desc box");
if (lines[end - 1].trim() !== "'</div>' +") throw new Error("line 962 is not the desc close");

const replacement = [
  `        '<button class="act' + (w.reaction==="like"?" on":"") + '" id="likeBtn">' + ICON.like + (w.likes?num(w.likes):"Like") + '</button>' +`,
  `        '<button class="act' + (w.reaction==="dislike"?" on":"") + '" id="dislikeBtn">' + ICON.dislike + 'Dislike</button>' +`,
  `        '<div class="act-div"></div>' +`,
  `        '<button class="act" id="shareBtn">' + ICON.share + 'Share</button>' +`,
  `        '<button class="act' + (isLater(v.id)?" on":"") + '" id="saveBtn">' + (isLater(v.id)?ICON.check:ICON.save) + (isLater(v.id)?"Saved":"Save") + '</button>' +`,
  `        '<button class="act speed-btn" id="speedBtn">' + ICON.speed + '<span id="speedLbl">' + (playRate===1?"Speed":playRate+"x") + '</span></button>' +`,
  `        '<button class="act" id="moreBtn">' + ICON.more + 'More</button>' +`,
  `      '</div>' +`,
  `      '<div class="desc clamp" id="descBox">' +`,
  `        '<div class="dmeta">' + esc(fmt(v.views)) + ' &middot; ' + esc(ago(v.created_at)) + (v.duration?" &middot; "+esc(dur(v.duration)):"") + '</div>' +`,
  `        (v.description ? esc(v.description) : "<i>No description</i>") +`,
  `        '<span class="dmore">...more</span>' +`,
  `      '</div>' +`,
];

lines.splice(start, end - start, ...replacement);
writeFileSync(path, lines.join("\n"));
console.log(`replaced ${end - start} lines with ${replacement.length}`);
