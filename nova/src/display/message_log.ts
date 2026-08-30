// Stacked fading message log (P4 of the ship-interaction layer): the
// bottom-center radio surface that one-shot flight traffic prints to —
// hail quotes ("over the radio", STR# 7101), flët hyperspace-entry quotes
// (finally consuming FleetQuotesResource), boarding chatter later on.
// Deliberately not coupled to the status bar, which is data-area-driven
// and has no message surface.

import { Entities, GetWorld, RunQuery, UUID } from "nova_ecs/arg_types";
import { EntityMap } from "nova_ecs/entity_map";
import { Plugin } from "nova_ecs/plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import {
    PERS_FLAG_QUOTE_ONCE,
    hailQuoteFacts,
    recordQuoteShown,
    shouldShowHailQuote,
} from "../missions/pers_offers";
import { queuePlayerStateSave } from "../missions/mission_plugin";
import { isShipDisabled } from "../missions/mission_ship_goals";
import { FleetQuotesResource } from "../nova_plugin/fleet_plugin";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { ArmorComponent, ShieldComponent } from "../nova_plugin/health_plugin";
import { HailEvent } from "../nova_plugin/interaction_plugin";
import { PersComponent } from "../nova_plugin/pers_plugin";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin";
import { ShipDataComponent } from "../nova_plugin/ship_plugin";
import { TargetComponent } from "../nova_plugin/target_component";
import { PlayerStateResource } from "../player/player_state_component";
import { ResizeEvent } from "./screen_size_plugin";
import { Stage } from "./stage_resource";

// A line lives this long, fading out over its final second.
const DEFAULT_TTL_S = 8;
const MAX_LINES = 5;
// STR# 7101: the përs HailQuote set (1-based indices, like STR# 7100).
const HAIL_QUOTE_STR = "nova:7101";

const FONT = {
    message: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'center', wordWrap: true, wordWrapWidth: 420,
    } as const,
};

export class MessageLog {
    readonly container = new PIXI.Container();
    private lines: Array<{ text: PIXI.Text, ttl: number }> = [];

    constructor() {
        this.container.name = 'MessageLog';
    }

    addMessage(text: string, ttl: number = DEFAULT_TTL_S): void {
        const label = new PIXI.Text(text, FONT.message);
        label.anchor.set(0.5);
        this.container.addChild(label);
        this.lines.push({ text: label, ttl });
        while (this.lines.length > MAX_LINES) {
            this.remove(this.lines[0]);
        }
        this.reflow();
    }

    // Per-frame aging; alpha ramps down over the last second of life.
    step(delta_s: number): void {
        for (const line of [...this.lines]) {
            line.ttl -= delta_s;
            line.text.alpha = Math.min(1, Math.max(0, line.ttl));
            if (line.ttl <= 0) {
                this.remove(line);
            }
        }
    }

    private remove(line: { text: PIXI.Text, ttl: number }): void {
        const index = this.lines.indexOf(line);
        if (index === -1) {
            return;
        }
        this.lines.splice(index, 1);
        this.container.removeChild(line.text);
        this.reflow();
    }

    // Newest line at the bottom, older ones stacked above.
    private reflow(): void {
        let y = 0;
        for (let i = this.lines.length - 1; i >= 0; i--) {
            const line = this.lines[i];
            line.text.position.y = y;
            y -= line.text.height + 4;
        }
    }
}

export const MessageLogResource = new Resource<MessageLog>('MessageLogResource');

const MessageLogResizeSystem = new System({
    name: 'MessageLogResize',
    events: [ResizeEvent] as const,
    args: [ResizeEvent, MessageLogResource, SingletonComponent] as const,
    step({ x, y }, log) {
        // Bottom-center, clear of the status bar.
        log.container.position.set(x / 2, y - 40);
    },
});

const MessageLogStepSystem = new System({
    name: 'MessageLogStep',
    args: [MessageLogResource, TimeResource, SingletonComponent] as const,
    step(log, time) {
        log.step(time.delta_s);
    },
});

// Flët hyperspace-entry quotes (fleet_plugin.ts collects them on spawn):
// drain the resource into the log.
const FleetQuoteSystem = new System({
    name: 'FleetQuoteMessages',
    args: [FleetQuotesResource, MessageLogResource, SingletonComponent] as const,
    step(quotes, log) {
        while (quotes.length > 0) {
            log.addMessage(quotes.shift()!);
        }
    },
});

const PlayerQuery = new Query([UUID, PlayerShipSelector] as const);

function targetName(entities: EntityMap, target: string): string {
    const ship = entities.get(target);
    const dataName = ship?.components.get(ShipDataComponent)?.name;
    return dataName ?? ship?.name ?? "Ship";
}

// What answers a hail: a përs whose quote gate passes reads its HailQuote
// over the radio; everything else (including përs whose 0x0004/0x0008/
// 0x0010/0x0020 gates fail) stays silent. The offer dialog, if any, is the
// comm plugin's business (display/comm_plugin.ts).
const HailQuoteSystem = new System({
    name: 'HailQuoteSystem',
    events: [HailEvent] as const,
    // SingletonComponent: run once per event, not once per entity.
    args: [HailEvent, Entities, GetWorld, MessageLogResource, RunQuery,
        SingletonComponent] as const,
    step({ target }, entities, world, log, runQuery) {
        const state = world.resources.get(PlayerStateResource);
        const gameData = world.resources.get(GameDataResource);
        if (!state || !gameData) {
            return;
        }
        const ship = entities.get(target);
        const pers = ship?.components.get(PersComponent);
        const playerUuid = runQuery(PlayerQuery)[0]?.[0];
        const facts = pers && ship ? hailQuoteFacts(pers.data, state, {
            grudge: pers.grudge,
            disabled: isShipDisabled(
                ship.components.get(ArmorComponent) ?? null,
                ship.components.get(ShieldComponent) ?? null),
            attacking: playerUuid !== undefined
                && ship.components.get(TargetComponent)?.target === playerUuid,
        }) : null;
        if (!pers || !facts || !shouldShowHailQuote(pers.data, facts)) {
            log.addMessage(`${targetName(entities, target)}: no response`);
            return;
        }

        // Quote-once latches on display (persisted, like the grudge).
        if ((pers.data.flags & PERS_FLAG_QUOTE_ONCE) !== 0
            && recordQuoteShown(state, pers.persId)) {
            queuePlayerStateSave();
        }

        // String lookups are async; the line lands in the log when the
        // set resolves.
        void gameData.data.StringSet.get(HAIL_QUOTE_STR)
            .then(set => set.strings[pers.data.hailQuote - 1] ?? null)
            .catch(() => null)
            .then(quote => log.addMessage(`${pers.data.name}: ${quote ?? "..."}`));
    },
});

export const MessageLogPlugin: Plugin = {
    name: 'MessageLogPlugin',
    build(world) {
        const log = new MessageLog();
        world.resources.set(MessageLogResource, log);
        const stage = world.resources.get(Stage);
        stage?.addChild(log.container);
        world.addSystem(MessageLogResizeSystem);
        world.addSystem(MessageLogStepSystem);
        world.addSystem(FleetQuoteSystem);
        world.addSystem(HailQuoteSystem);
    },
    remove(world) {
        world.removeSystem(MessageLogResizeSystem);
        world.removeSystem(MessageLogStepSystem);
        world.removeSystem(FleetQuoteSystem);
        world.removeSystem(HailQuoteSystem);
        const log = world.resources.get(MessageLogResource);
        const stage = world.resources.get(Stage);
        if (log && stage) {
            stage.removeChild(log.container);
        }
        world.resources.delete(MessageLogResource);
    },
};
