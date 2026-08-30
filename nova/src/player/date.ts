// The EV Nova calendar: dates are day/month/year triplets, and one Nova day
// passes per hyperspace jump. Months have real-world lengths and there are no
// leap years (crön FirstDay/LastDay fields accept 1-31), e.g. stock chär 128
// starts on 23-Jun-1177.

export interface NovaDate {
    day: number;
    month: number;
    year: number;
}

// Days in each month, 1-indexed. No leap years in the Nova calendar.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Month abbreviations as Nova displays them ("23-Jun-1177").
const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function novaDate(day: number, month: number, year: number): NovaDate {
    return { day, month, year };
}

export function cloneDate(date: NovaDate): NovaDate {
    return { day: date.day, month: date.month, year: date.year };
}

// Day count since 1-Jan-0, day 1 = 1. Used for date arithmetic and compares.
function toAbsolute(date: NovaDate): number {
    let dayOfYear = date.day;
    for (let month = 1; month < date.month; month++) {
        dayOfYear += DAYS_IN_MONTH[month - 1];
    }
    return date.year * 365 + dayOfYear;
}

function fromAbsolute(absolute: number): NovaDate {
    const year = Math.floor((absolute - 1) / 365);
    let dayOfYear = absolute - year * 365;
    let month = 1;
    while (month <= DAYS_IN_MONTH.length && dayOfYear > DAYS_IN_MONTH[month - 1]) {
        dayOfYear -= DAYS_IN_MONTH[month - 1];
        month += 1;
    }
    return { day: dayOfYear, month, year };
}

// Returns a NEW date advanced by `days` (which may be zero or negative),
// rolling over months and years as needed.
export function advanceDate(date: NovaDate, days: number): NovaDate {
    return fromAbsolute(toAbsolute(date) + days);
}

// Negative if `a` is before `b`, zero if equal, positive if after.
export function compareDates(a: NovaDate, b: NovaDate): number {
    return toAbsolute(a) - toAbsolute(b);
}

export function isDeadlinePassed(now: NovaDate, deadline: NovaDate): boolean {
    return compareDates(now, deadline) > 0;
}

// Formats e.g. {23, 6, 1177} with the chär's datePrefix/dateSuffix as
// "23-Jun-1177 NC".
export function formatDate(date: NovaDate, prefix = "", suffix = ""): string {
    const monthName = MONTH_NAMES[date.month - 1] ?? String(date.month);
    return `${prefix}${date.day}-${monthName}-${date.year}${suffix}`;
}
