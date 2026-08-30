// The bar: missions offered by patrons (AvailLoc 1). Like the mission BBS
// but refusing an offer here may show the mission's RefuseText (dësc text,
// expanded like a briefing). The spaceport only adds a Bar button on
// planets with a bar (spöb flag 0x00040 → PlanetData.hasBar).

import { Observable } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { MissionEffect } from '../missions/mission_state_machine';
import { TextDialog } from './briefing';
import {
    MissionBBS,
    MissionOffer,
    MissionUiEnv,
} from './mission_bbs';
import { expandMissionText } from './mission_text';

export class Bar extends MissionBBS {
    private refuseTextDialog: TextDialog;

    constructor(makeUi: () => Promise<MissionUiEnv>,
        controlEvents: Observable<ControlEvent>, gameData: GameData) {
        super(makeUi, controlEvents, gameData);
        this.container.name = 'Bar';
        this.refuseTextDialog = new TextDialog(gameData, controlEvents);
        this.container.addChild(this.refuseTextDialog.container);
    }

    override async showOffers(offers: MissionOffer[],
        onRefused?: (offer: MissionOffer, effects: MissionEffect[]) => Promise<void>):
        Promise<void> {
        await super.showOffers(offers, async (offer, effects) => {
            await this.showRefuseText(offer, effects);
            if (onRefused) {
                await onRefused(offer, effects);
            }
        });
    }

    // Bar refusals show the mission's RefuseText, expanded against the
    // current state like a briefing (the state machine ships the raw dësc
    // text in the effect; mutable blocks may have flipped on refusal).
    private async showRefuseText(offer: MissionOffer, effects: MissionEffect[]) {
        const refused = effects.find(effect => effect.kind === "text"
            && effect.purpose === "refuse");
        if (!refused || refused.kind !== "text") {
            return;
        }
        await this.refuseTextDialog.showText(
            expandMissionText(refused.text, offer.textCtx));
    }
}
