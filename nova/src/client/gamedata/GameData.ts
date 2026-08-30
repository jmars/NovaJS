import { BaseData } from 'novadatainterface/BaseData';
import { CharData } from 'novadatainterface/CharData';
import { CicnData } from 'novadatainterface/CicnData';
import { DescData } from 'novadatainterface/DescData';
import { DudeData } from 'novadatainterface/DudeData';
import { PersData } from 'novadatainterface/PersData';
import { FleetData } from 'novadatainterface/FleetData';
import { GovernmentData } from 'novadatainterface/GovernmentData';
import { CicnImageData } from 'novadatainterface/CicnImage';
import { ExplosionData } from 'novadatainterface/ExplosionData';
import { GameDataInterface, PreloadData } from 'novadatainterface/GameDataInterface';
import { Gettable } from 'novadatainterface/Gettable';
import { NovaDataInterface, NovaDataType } from 'novadatainterface/NovaDataInterface';
import { NovaIDs } from 'novadatainterface/NovaIDs';
import { MissionData } from 'novadatainterface/MissionData';
import { CronData } from 'novadatainterface/CronData';
import { OutfitData } from 'novadatainterface/OutiftData';
import { PictData } from 'novadatainterface/PictData';
import { RankData } from 'novadatainterface/RankData';
import { JunkData } from 'novadatainterface/JunkData';
import { StringSetData } from 'novadatainterface/StringSetData';
import { PictImageData } from 'novadatainterface/PictImage';
import { PlanetData } from 'novadatainterface/PlanetData';
import { ShipData } from 'novadatainterface/ShipData';
import { SoundFile } from 'novadatainterface/SoundFile';
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from 'novadatainterface/SpriteSheetData';
import { StatusBarData } from 'novadatainterface/StatusBarData';
import { SystemData } from 'novadatainterface/SystemData';
import { TargetCornersData } from 'novadatainterface/TargetCornersData';
import { WeaponData } from 'novadatainterface/WeaponData';
import * as PIXI from 'pixi.js';
import * as sound from '@pixi/sound';
import urlJoin from 'url-join';
import { dataPath, idsPath } from '../../common/GameDataPaths';
import { bundleReady, texturesReady } from './bundle_loader';
import PQueue from 'p-queue';

class WeaponGettable extends Gettable<WeaponData> {
    override async get(id: string, priority = 0) {
        if (id in this.data) {
            return await super.get(id);
        }

        const weapon = await super.get(id, priority);
        if (weapon.type === 'ProjectileWeaponData') {
            await Promise.all(weapon.submunitions.map(s => this.get(s.id, priority)));
        }
        return weapon;
    }
}

/**
 * Retrieves game data from the server
 */
export class GameData implements GameDataInterface {
    public readonly data: NovaDataInterface & {
        Sound: Gettable<sound.Sound>,
    };
    public readonly ids: Promise<NovaIDs>;
    readonly preloadData: Promise<PreloadData>;
    public loaded = Promise.resolve();
    /** Resolves once the bundle's textures are in the Assets cache (no-op in
     * network-fallback mode). Browser boot awaits this so synchronous
     * Texture.from/Sprite.from calls never fall through to the network. */
    public readonly texturesReady = texturesReady;
    private loadQueue = new PQueue({
        autoStart: true,
        concurrency: 16,
    });

    constructor() {
        // There should be a better way to do this. I'm repeating myself here.
        this.data = {
            Ship: this.addGettable<ShipData>(NovaDataType.Ship),
            Outfit: this.addGettable<OutfitData>(NovaDataType.Outfit),
            Weapon: this.addWeaponGettable(),
            Pict: this.addGettable<PictData>(NovaDataType.Pict),
            PictImage: this.addPictGettable<PictImageData>(NovaDataType.PictImage),
            Cicn: this.addGettable<CicnData>(NovaDataType.Cicn),
            CicnImage: this.addPictGettable<CicnImageData>(NovaDataType.CicnImage),
            Planet: this.addGettable<PlanetData>(NovaDataType.Planet),
            System: this.addGettable<SystemData>(NovaDataType.System),
            TargetCorners: this.addGettable<TargetCornersData>(NovaDataType.TargetCorners),
            SpriteSheet: this.addGettable<SpriteSheetData>(NovaDataType.SpriteSheet),
            SpriteSheetImage: this.addPictGettable<SpriteSheetImageData>(NovaDataType.SpriteSheetImage),
            SpriteSheetFrames: this.addTextureGettable<SpriteSheetFramesData>(NovaDataType.SpriteSheetFrames),
            StatusBar: this.addGettable<StatusBarData>(NovaDataType.StatusBar),
            Explosion: this.addGettable<ExplosionData>(NovaDataType.Explosion),
            SoundFile: this.addSoundFileGettable(),
            Sound: this.addSoundGettable(),
            Mission: this.addGettable<MissionData>(NovaDataType.Mission),
            Cron: this.addGettable<CronData>(NovaDataType.Cron),
            Government: this.addGettable<GovernmentData>(NovaDataType.Government),
            Dude: this.addGettable<DudeData>(NovaDataType.Dude),
            Pers: this.addGettable<PersData>(NovaDataType.Pers),
            Fleet: this.addGettable<FleetData>(NovaDataType.Fleet),
            Rank: this.addGettable<RankData>(NovaDataType.Rank),
            Junk: this.addGettable<JunkData>(NovaDataType.Junk),
            StringSet: this.addGettable<StringSetData>(NovaDataType.StringSet),
            Char: this.addGettable<CharData>(NovaDataType.Char),
            Desc: this.addGettable<DescData>(NovaDataType.Desc),
        };

        this.preloadData = this.preload();
        this.loaded = this.preloadData.then(() => { });

        this.ids = this.getIds();
    }

    getSettings(file: string): Promise<unknown> {
        return this.getUrl(urlJoin("settings", file));
    }

    private async preload() {
        // The bundle (when present) serves this through the BundleLoadParser;
        // otherwise the stock parser fetches it as before.
        await bundleReady;
        const data = await PIXI.Assets.load<PreloadData>('preloadData.json');
        for (const [uncastKey, val] of Object.entries(data)) {
            const key = uncastKey as keyof typeof data;
            this.data[key].gotten = val;
        }
        return data;
    }

    private async getUrl(url: string, priority = 0): Promise<unknown> {
        // Wait for the bundle index; in bundle mode the load below is then
        // served from memory by the BundleLoadParser instead of the network.
        await bundleReady;
        await this.preloadData;
        return PIXI.Assets.load(url);
    }

    private getDataPrefix(dataType: NovaDataType): string {
        return urlJoin(dataPath, dataType);
    }

    private addGettable<T extends BaseData | SpriteSheetFramesData>(dataType: NovaDataType): Gettable<T> {
        const dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string, priority: number): Promise<T> => {
            return (await this.getUrl(urlJoin(dataPrefix, id + ".json"), priority)) as any;
        });
    }

    private addTextureGettable<T extends BaseData | SpriteSheetFramesData>(dataType: NovaDataType): Gettable<T> {
        const dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string, priority: number): Promise<T> => {
            return (await this.getUrl(urlJoin(dataPrefix, id + ".json"), priority) as {data: any}).data as any;
        });
    }

    private addWeaponGettable(): WeaponGettable {
        const dataPrefix = this.getDataPrefix(NovaDataType.Weapon);
        return new WeaponGettable(async (id: string, priority: number): Promise<WeaponData> => {
            return (await this.getUrl(urlJoin(dataPrefix, id + ".json"), priority)) as any;
        });

    }

    private addPictGettable<T extends PictImageData | SpriteSheetImageData>(dataType: NovaDataType): Gettable<T> {
        var dataPrefix = this.getDataPrefix(dataType);
        return new Gettable<T>(async (id: string, priority: number): Promise<T> => {
            return <T>((await this.getUrl(urlJoin(dataPrefix, id) + ".png", priority)) as Buffer).buffer;
        });
    }

    private addSoundFileGettable() {
        const dataPrefix = this.getDataPrefix(NovaDataType.SoundFile);
        return new Gettable<SoundFile>(async (id: string, priority: number) => {
            //return await (await fetch(urlJoin(dataPrefix, id))).arrayBuffer();
            return ((await this.getUrl(urlJoin(dataPrefix, id) + '.mp3', priority)) as Buffer);
        });
    }

    private url(id: string): string {
        return urlJoin(dataPath, NovaDataType.PictImage, id + ".png");
    }

    textureFromPict(id: string): PIXI.Texture {
        return PIXI.Texture.from(this.url(id));
    }

    spriteFromPict(id: string) {
        return PIXI.Sprite.from(this.url(id));
    }

    async textureFromPictAsync(id: string, priority?: number) {
        const pictPath = this.url(id);
        await this.data.PictImage.get(id, priority);
        return PIXI.Texture.from(pictPath);
    }

    async spriteFromPictAsync(id: string, priority?: number) {
        // TODO: Use this.data
        var texture = await this.textureFromPictAsync(id, priority);
        return new PIXI.Sprite(texture);
    }

    async textureFromCicn(id: string): Promise<PIXI.Texture> {
        const cicnPath = urlJoin(dataPath, NovaDataType.CicnImage, id + ".png");
        await this.data.CicnImage.get(id);
        return PIXI.Texture.from(cicnPath);
    }

    private addSoundGettable() {
        const dataPrefix = this.getDataPrefix(NovaDataType.SoundFile);
        return new Gettable<sound.Sound>(async (id, priority) => {
            const soundPath = urlJoin(dataPrefix, id) + '.mp3';
            // Through getUrl so the bundle parser materializes the Sound from
            // memory; in fallback mode @pixi/sound's own Assets parser loads
            // it from the network.
            return (await this.getUrl(soundPath, priority)) as sound.Sound;
        });
    }

    private async getIds(): Promise<NovaIDs> {
        // Bundle-served when present (see preload), plain fetch otherwise.
        await bundleReady;
        return (await PIXI.Assets.load<NovaIDs>(idsPath + ".json"));
    }
}
