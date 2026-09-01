// Pure reference model of the binary's ränk 0x0004 ship-loss stripping, for
// a side-by-side trace harness (combat_rating_trace_test.ts): when the player
// destroys or disables a ship, every active rank that is flag-0x0004 (lost
// when a ship of that govt is killed), is not permanent (0x0008), and belongs
// to the lost ship's government (or one of its allies, either direction) is
// deactivated.
//
// The model is a pure function of the active-rank ids, the rank table, the
// lost ship's government, and the government table (allies are a classes ∩
// allies intersection, positional-class government relations per the binary's
// FUN_0046bff0 family). The port's deactivateRanksOnShipLoss (legal_status.ts)
// must return exactly this deactivated set for every configuration.

export interface RankLike {
    id: string;
    govt: string | null;
    flags: number;
}

export interface GovtLike {
    id: string;
    classes: number[];
    allies: number[];
}

// FUN_0046bff0-family alliance: government `a` considers `b` an ally when
// one of a's classes appears in b's allies list.
export function govtsAreAllies(a: GovtLike, b: GovtLike): boolean {
    return a.classes.some(c => b.allies.includes(c));
}

// Which active rank ids the binary strips when a `shipGovtId` ship is lost.
// rankOf/governmentOf return null for unknown ids. Mirrors
// legal_status.deactivateRanksOnShipLoss exactly.
export function deactivateRanksOnShipLoss(
    activeRanks: string[],
    rankOf: (id: string) => RankLike | null,
    shipGovtId: string,
    governmentOf: (id: string) => GovtLike | null): string[] {
    const shipGovt = governmentOf(shipGovtId);
    if (!shipGovt) {
        return [];
    }
    const deactivated: string[] = [];
    for (const id of activeRanks) {
        const rank = rankOf(id);
        if (!rank || (rank.flags & 0x0004) === 0 || (rank.flags & 0x0008) !== 0) {
            continue;
        }
        if (rank.govt === null) {
            continue;
        }
        if (rank.govt === shipGovt.id) {
            deactivated.push(id);
            continue;
        }
        const affiliated = governmentOf(rank.govt);
        if (affiliated !== null
            && (govtsAreAllies(affiliated, shipGovt)
                || govtsAreAllies(shipGovt, affiliated))) {
            deactivated.push(id);
        }
    }
    return deactivated;
}
