// Deploy version for cache busting. generate_static embeds it into
// dist-site/index.html twice: as a "?v=" query parameter on the
// browser_bundle.js script tag and as window.NOVA_VERSION, which
// bundle_loader.ts appends to the game-data bundle fetch — so a redeploy
// busts stale cached copies of both the script and the bundle.
//
// The version is the git short sha when the build runs from a checkout
// (CI included), else a wall-clock timestamp, so it changes on every
// deploy either way.

import { execSync } from "child_process";

/** Pure core: the git sha when one is available, else a timestamp (which
 * differs on every call). */
export function versionFrom(sha: string | null, now: () => number): string {
    var trimmed = sha === null ? "" : sha.trim();
    return trimmed !== "" ? trimmed : "t" + now();
}

/** The short sha of the current checkout, or null outside a git repo
 * (e.g. a source-tarball build). */
function gitShortSha(): string | null {
    try {
        return execSync("git rev-parse --short HEAD", {
            encoding: "utf8",
            // A missing repo prints its error on stderr; keep that out of
            // the build output.
            stdio: ["ignore", "pipe", "ignore"],
        });
    }
    catch (e) {
        return null;
    }
}

export function currentVersion(): string {
    return versionFrom(gitShortSha(), Date.now);
}

/** Injects the version into the index.html template: an inline script
 * before the bundle tag (so window.NOVA_VERSION exists before any loader
 * code runs) and a versioned script src. Pure so headless tests can check
 * the exact output. Throws when the template has no bundle script tag. */
export function injectVersion(template: string, version: string): string {
    var versioned = template.replace('src="browser_bundle.js"',
        'src="browser_bundle.js?v=' + version + '"');
    if (versioned === template) {
        throw new Error("No browser_bundle.js script tag in index.html template");
    }
    var scriptStart = versioned.indexOf("<script");
    if (scriptStart < 0) {
        throw new Error("No script tag in index.html template");
    }
    return versioned.slice(0, scriptStart)
        + "<script>window.NOVA_VERSION = " + JSON.stringify(version) + ";</script>\n"
        + versioned.slice(scriptStart);
}
