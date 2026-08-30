// The active-missions info screen (the stock game's 'i' key / Info button):
// one entry per active mission showing its QuickBrief plus where the
// mission stands (travel leg, cargo, deadline, special-ship goal).

import { MissionData } from "novadatainterface/MissionData";
import { Observable } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { rawIdOf } from '../missions/stellar_filter';
import { formatDate } from '../player/date';
import { ActiveMission } from '../player/player_state';
import { TextDialog } from './briefing';
import { makeOfferTextContext, MissionUiEnv } from './mission_bbs';
import { CARGO_NAME_STR, expandMissionText } from './mission_text';

export class MissionInfo extends TextDialog {
    constructor(controlEvents: Observable<ControlEvent>, gameData: GameData) {
        super(gameData, controlEvents, "Info");
    }
}

// Renders the info text for every active mission. Returns a friendly
// message when nothing is active.
export async function renderMissionInfo(ui: MissionUiEnv): Promise<string> {
    const missions: Array<MissionData | null> = ui.playerState.activeMissions
        .map(active => ui.env.missionByRawId(rawIdOf(active.missionId)));
    const loaded = missions.filter((mission): mission is MissionData => mission !== null);
    await ui.textEnv.preload(ui.playerState, loaded);

    if (loaded.length === 0) {
        return "You have no active missions.";
    }

    const blocks: Array<string> = [];
    for (const active of ui.playerState.activeMissions) {
        const mission = ui.env.missionByRawId(rawIdOf(active.missionId));
        if (mission) {
            blocks.push(await missionBlock(ui, mission, active));
        }
    }
    return blocks.join("\r\r");
}

async function missionBlock(ui: MissionUiEnv, mission: MissionData,
    active: ActiveMission): Promise<string> {
    const textCtx = makeOfferTextContext(ui, mission, active);

    const lines: Array<string> = [];
    const quickBriefId = mission.quickBrief ?? mission.briefText;
    if (quickBriefId !== null) {
        try {
            const quickBrief = await ui.gameData.data.Desc.get(quickBriefId);
            lines.push(expandMissionText(quickBrief.text, textCtx));
        }
        catch {
            // Missing dësc: the objective lines below still show.
        }
    }

    if (active.travelStellar !== null && !active.travelComplete) {
        const destination = ui.env.planet(active.travelStellar);
        lines.push(`Travel to ${destination?.name ?? "your destination"}.`);
    }
    if (active.cargo !== null) {
        const strings = ui.textEnv.stringSetByRawId(CARGO_NAME_STR)?.strings ?? [];
        const name = (strings[active.cargo.type] ?? "cargo").replace(/^\*/, "");
        lines.push(active.cargoLoaded
            ? `${active.cargo.qty} tons of ${name} on board.`
            : `Pick up ${active.cargo.qty} tons of ${name}.`);
    }
    if (active.deadline !== null) {
        lines.push(`Complete by ${formatDate(active.deadline)}.`);
    }
    if (mission.shipGoal !== -1 && active.specialShips !== null) {
        lines.push(active.shipGoalComplete
            ? "Objective complete."
            : `${active.specialShips.remaining} target ship(s) remaining.`);
    }
    if (active.travelComplete
        && (mission.shipGoal === -1 || active.shipGoalComplete)
        && active.returnStellar !== null) {
        const returnStellar = ui.env.planet(active.returnStellar);
        lines.push(`Return to ${returnStellar?.name ?? "your employer"}.`);
    }
    return lines.join("\r");
}
