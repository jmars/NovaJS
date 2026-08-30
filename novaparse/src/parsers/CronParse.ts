import { CronData } from "novadatainterface/CronData";
import { BaseParse } from "./BaseParse";
import { CronResource } from "../resource_parsers/CronResource";


// Resolves a crön into its global form. Cröns reference other resources only
// through raw ids inside their expression and news STR# fields (resolved at
// run time), so nothing here needs the id space.
export async function CronParse(cron: CronResource, notFoundFunction: (m: string) => void): Promise<CronData> {
    var base = await BaseParse(cron, notFoundFunction);

    return {
        ...base,
        firstDay: cron.firstDay,
        firstMonth: cron.firstMonth,
        firstYear: cron.firstYear,
        lastDay: cron.lastDay,
        lastMonth: cron.lastMonth,
        lastYear: cron.lastYear,
        random: cron.random,
        duration: cron.duration,
        preHoldoff: cron.preHoldoff,
        postHoldoff: cron.postHoldoff,
        flags: cron.flags,
        enableOn: cron.enableOn,
        onStart: cron.onStart,
        onEnd: cron.onEnd,
        contribute: cron.contribute,
        require: cron.require,
        newsGovt: cron.newsGovt,
        govtNewsStr: cron.govtNewsStr,
        indNewsStr: cron.indNewsStr,
    };
}
