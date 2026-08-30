import { BaseData, getDefaultBaseData } from "./BaseData";


// Crön (cron) resources: time-dependent events driven by control bits
// (Nova Bible "The crön resource"). All expression fields keep the raw
// resource text; the crön scheduler (nova/src/missions/cron_scheduler.ts)
// parses them at run time.
export interface CronData extends BaseData {
    // Activation window. Any field set to 0 or -1 is a wildcard that matches
    // anything (checked component-wise against the game date).
    firstDay: number;         // 1-31
    firstMonth: number;       // 1-12
    firstYear: number;
    lastDay: number;
    lastMonth: number;
    lastYear: number;
    random: number;           // percent chance per eligible day; 100 = asap
    duration: number;         // days active; 0 = OnStart and OnEnd same day
    preHoldoff: number;       // days held after activation before OnStart
    postHoldoff: number;      // days held after OnEnd before deactivation
    flags: number;            // 0x0001 continuous-iterative OnStart, 0x0002 OnEnd
    enableOn: string;         // raw test expression ("" = eligible)
    onStart: string;          // raw set expression, run after PreHoldoff
    onEnd: string;            // raw set expression, run when Duration ends
    contribute: [number, number]; // 64-bit flag merged into the pool while active
    require: [number, number];    // 64-bit mask; every set bit must be covered
    newsGovt: [number, number, number, number];     // -1 = unused
    govtNewsStr: [number, number, number, number];  // -1 = unused
    indNewsStr: number;       // STR# for independent news; -1 = none
}

export function getDefaultCronData(): CronData {
    return {
        ...getDefaultBaseData(),
        firstDay: 0,
        firstMonth: 0,
        firstYear: 0,
        lastDay: 0,
        lastMonth: 0,
        lastYear: 0,
        random: 100,
        duration: 0,
        preHoldoff: 0,
        postHoldoff: 0,
        flags: 0,
        enableOn: "",
        onStart: "",
        onEnd: "",
        contribute: [0, 0],
        require: [0, 0],
        newsGovt: [-1, -1, -1, -1],
        govtNewsStr: [-1, -1, -1, -1],
        indNewsStr: -1,
    };
}
