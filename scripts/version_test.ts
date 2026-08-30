import "jasmine";
import { injectVersion, versionFrom } from "./version";

describe("version", function() {
    it("prefers the git short sha", function() {
        expect(versionFrom("abc1234\n", () => 1000)).toEqual("abc1234");
    });

    it("falls back to a timestamp outside a git repo", function() {
        expect(versionFrom(null, () => 1700000000000)).toEqual("t1700000000000");
        // Whitespace-only output counts as missing, too.
        expect(versionFrom("  \n", () => 1700000000001)).toEqual("t1700000000001");
    });

    it("versions the script tag and sets window.NOVA_VERSION before it", function() {
        const html = injectVersion(
            "<body>\n  <div id=\"loading\"></div>\n"
            + "  <script type=\"application/javascript\" src=\"browser_bundle.js\"></script>\n"
            + "</body>",
            "abc1234");

        expect(html).toContain('src="browser_bundle.js?v=abc1234"');
        expect(html).toContain("<script>window.NOVA_VERSION = \"abc1234\";</script>");
        // The inline script must run before the bundle loads.
        expect(html.indexOf("window.NOVA_VERSION"))
            .toBeLessThan(html.indexOf("browser_bundle.js?v="));
    });

    it("rejects a template without the bundle script tag", function() {
        expect(function() { injectVersion("<body></body>", "abc1234"); })
            .toThrowError(/browser_bundle/);
    });
});
