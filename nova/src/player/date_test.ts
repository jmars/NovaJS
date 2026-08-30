import "jasmine";
import {
    advanceDate,
    compareDates,
    formatDate,
    isDeadlinePassed,
    novaDate,
} from "./date";


describe("NovaDate", function() {
    it("advances within a month", function() {
        expect(advanceDate(novaDate(23, 6, 1177), 1)).toEqual(novaDate(24, 6, 1177));
    });

    it("rolls over months and years", function() {
        // January has 31 days.
        expect(advanceDate(novaDate(30, 1, 1177), 3)).toEqual(novaDate(2, 2, 1177));
        // December has 31 days.
        expect(advanceDate(novaDate(30, 12, 1177), 5)).toEqual(novaDate(4, 1, 1178));
        // Zero and negative advances.
        expect(advanceDate(novaDate(1, 3, 1177), 0)).toEqual(novaDate(1, 3, 1177));
        expect(advanceDate(novaDate(1, 3, 1177), -1)).toEqual(novaDate(28, 2, 1177));
    });

    it("advances by many days in one step", function() {
        expect(advanceDate(novaDate(23, 6, 1177), 365)).toEqual(novaDate(23, 6, 1178));
    });

    it("compares deadlines", function() {
        expect(compareDates(novaDate(23, 6, 1177), novaDate(24, 6, 1177))).toBeLessThan(0);
        expect(compareDates(novaDate(24, 6, 1177), novaDate(24, 6, 1177))).toEqual(0);
        expect(compareDates(novaDate(1, 1, 1178), novaDate(31, 12, 1177))).toBeGreaterThan(0);
        expect(isDeadlinePassed(novaDate(1, 7, 1177), novaDate(30, 6, 1177))).toBeTrue();
        // Landing on the deadline day itself is not late.
        expect(isDeadlinePassed(novaDate(30, 6, 1177), novaDate(30, 6, 1177))).toBeFalse();
    });

    it("formats with the chär's prefix and suffix", function() {
        expect(formatDate(novaDate(23, 6, 1177), "", " NC")).toEqual("23-Jun-1177 NC");
        expect(formatDate(novaDate(1, 12, 1200))).toEqual("1-Dec-1200");
    });
});
