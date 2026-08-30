import * as fs from "fs";
import { BaseData } from "novadatainterface/BaseData";
import { CharData } from "novadatainterface/CharData";
import { CicnData } from "novadatainterface/CicnData";
import { DescData } from "novadatainterface/DescData";
import { DudeData } from "novadatainterface/DudeData";
import { PersData } from "novadatainterface/PersData";
import { FleetData } from "novadatainterface/FleetData";
import { GovernmentData } from "novadatainterface/GovernmentData";
import { CicnImageData } from "novadatainterface/CicnImage";
import { ExplosionData } from "novadatainterface/ExplosionData";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { Gettable } from "novadatainterface/Gettable";
import { NovaDataInterface } from "novadatainterface/NovaDataInterface";
import { NovaIDs } from "novadatainterface/NovaIDs";
import { MissionData } from "novadatainterface/MissionData";
import { CronData } from "novadatainterface/CronData";
import { OutfitData } from "novadatainterface/OutiftData";
import { PictData } from "novadatainterface/PictData";
import { RankData } from "novadatainterface/RankData";
import { JunkData } from "novadatainterface/JunkData";
import { StringSetData } from "novadatainterface/StringSetData";
import { PictImageData } from "novadatainterface/PictImage";
import { PlanetData } from "novadatainterface/PlanetData";
import { ShipData } from "novadatainterface/ShipData";
import { SoundFile } from "novadatainterface/SoundFile";
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from "novadatainterface/SpriteSheetData";
import { StatusBarData } from "novadatainterface/StatusBarData";
import { SystemData } from "novadatainterface/SystemData";
import { TargetCornersData } from "novadatainterface/TargetCornersData";
import { WeaponData } from "novadatainterface/WeaponData";
import * as path from "path";


type PathInfo = {
    path: string,
    extension: string
};

const Paths = {
    Ship: { path: "Ship", extension: "json" } as PathInfo,
    Outfit: { path: "Outfit", extension: "json" } as PathInfo,
    Weapon: { path: "Weapon", extension: "json" } as PathInfo,
    Pict: { path: "Pict", extension: "json" } as PathInfo,
    PictImage: { path: "PictImage", extension: "png" } as PathInfo,
    Cicn: { path: "Cicn", extension: "json" } as PathInfo,
    CicnImage: { path: "CicnImage", extension: "png" } as PathInfo,
    Planet: { path: "Planet", extension: "json" } as PathInfo,
    System: { path: "System", extension: "json" } as PathInfo,
    TargetCorners: { path: "TargetCorners", extension: "json" } as PathInfo,
    SpriteSheet: { path: "SpriteSheet", extension: "json" } as PathInfo,
    SpriteSheetImage: { path: "SpriteSheetImage", extension: "png" } as PathInfo,
    SpriteSheetFrames: { path: "SpriteSheetFrames", extension: "json" } as PathInfo,
    StatusBar: { path: "StatusBar", extension: "json" } as PathInfo,
    Explosion: { path: "Explosion", extension: "json" } as PathInfo,
    SoundFile: { path: "SoundFile", extension: "mp3" } as PathInfo,
    Mission: { path: "Mission", extension: "json" } as PathInfo,
    Cron: { path: "Cron", extension: "json" } as PathInfo,
    Government: { path: "Government", extension: "json" } as PathInfo,
    Dude: { path: "Dude", extension: "json" } as PathInfo,
    Pers: { path: "Pers", extension: "json" } as PathInfo,
    Fleet: { path: "Fleet", extension: "json" } as PathInfo,
    Rank: { path: "Rank", extension: "json" } as PathInfo,
    Junk: { path: "Junk", extension: "json" } as PathInfo,
    StringSet: { path: "StringSet", extension: "json" } as PathInfo,
    Char: { path: "Char", extension: "json" } as PathInfo,
    Desc: { path: "Desc", extension: "json" } as PathInfo,
};

class FilesystemData implements GameDataInterface {
    public ids: Promise<NovaIDs>;
    public data: NovaDataInterface;

    constructor(private rootPath: string) {
        this.data = {
            Ship: this.getFunction<ShipData>(Paths.Ship),
            Outfit: this.getFunction<OutfitData>(Paths.Outfit),
            Weapon: this.getFunction<WeaponData>(Paths.Weapon),
            Pict: this.getFunction<PictData>(Paths.Pict),
            PictImage: this.getFunction<PictImageData>(Paths.PictImage),
            Cicn: this.getFunction<CicnData>(Paths.Cicn),
            CicnImage: this.getFunction<CicnImageData>(Paths.CicnImage),
            Planet: this.getFunction<PlanetData>(Paths.Planet),
            System: this.getFunction<SystemData>(Paths.System),
            TargetCorners: this.getFunction<TargetCornersData>(Paths.TargetCorners),
            SpriteSheet: this.getFunction<SpriteSheetData>(Paths.SpriteSheet),
            SpriteSheetImage: this.getFunction<SpriteSheetImageData>(Paths.SpriteSheetImage),
            SpriteSheetFrames: this.getFunction<SpriteSheetFramesData>(Paths.SpriteSheetFrames),
            StatusBar: this.getFunction<StatusBarData>(Paths.StatusBar),
            Explosion: this.getFunction<ExplosionData>(Paths.Explosion),
            SoundFile: this.getFunction<SoundFile>(Paths.SoundFile),
            Mission: this.getFunction<MissionData>(Paths.Mission),
            Cron: this.getFunction<CronData>(Paths.Cron),
            Government: this.getFunction<GovernmentData>(Paths.Government),
            Dude: this.getFunction<DudeData>(Paths.Dude),
            Pers: this.getFunction<PersData>(Paths.Pers),
            Fleet: this.getFunction<FleetData>(Paths.Fleet),
            Rank: this.getFunction<RankData>(Paths.Rank),
            Junk: this.getFunction<JunkData>(Paths.Junk),
            StringSet: this.getFunction<StringSetData>(Paths.StringSet),
            Char: this.getFunction<CharData>(Paths.Char),
            Desc: this.getFunction<DescData>(Paths.Desc),
        }
        this.ids = this.buildIDs();
    }

    getFunction<T extends BaseData | PictImageData | SpriteSheetFramesData>(p: PathInfo): Gettable<T> {
        // Returns a gettable that loads the resource from a file
        return new Gettable<T>((id: string) => {
            return new Promise<T>((fulfill, reject) => {
                fs.readFile(path.join(this.rootPath, p.path, id + "." + p.extension),
                    function(err, contents) {
                        if (err) {
                            reject(err);
                        }
                        else {
                            if (p.extension == "json") {
                                fulfill(JSON.parse(contents.toString('utf8')) as T)
                            }
                            else if (p.extension == "png") {
                                fulfill(contents.buffer as T);
                            }
                            else {
                                reject("Unsupported");
                            }
                        }
                    });
            });
        });
    }

    async buildIDs(): Promise<NovaIDs> {
        return {
            Ship: await this.buildIDsForPath(Paths.Ship),
            Outfit: await this.buildIDsForPath(Paths.Outfit),
            Weapon: await this.buildIDsForPath(Paths.Weapon),
            Pict: await this.buildIDsForPath(Paths.Pict),
            PictImage: await this.buildIDsForPath(Paths.PictImage),
            Cicn: await this.buildIDsForPath(Paths.Cicn),
            CicnImage: await this.buildIDsForPath(Paths.CicnImage),
            Planet: await this.buildIDsForPath(Paths.Planet),
            System: await this.buildIDsForPath(Paths.System),
            TargetCorners: await this.buildIDsForPath(Paths.TargetCorners),
            SpriteSheet: await this.buildIDsForPath(Paths.SpriteSheet),
            SpriteSheetImage: await this.buildIDsForPath(Paths.SpriteSheetImage),
            SpriteSheetFrames: await this.buildIDsForPath(Paths.SpriteSheetFrames),
            StatusBar: await this.buildIDsForPath(Paths.StatusBar),
            Explosion: await this.buildIDsForPath(Paths.Explosion),
            SoundFile: await this.buildIDsForPath(Paths.SoundFile),
            Mission: await this.buildIDsForPath(Paths.Mission),
            Cron: await this.buildIDsForPath(Paths.Cron),
            Government: await this.buildIDsForPath(Paths.Government),
            Dude: await this.buildIDsForPath(Paths.Dude),
            Pers: await this.buildIDsForPath(Paths.Pers),
            Fleet: await this.buildIDsForPath(Paths.Fleet),
            Rank: await this.buildIDsForPath(Paths.Rank),
            Junk: await this.buildIDsForPath(Paths.Junk),
            StringSet: await this.buildIDsForPath(Paths.StringSet),
            Char: await this.buildIDsForPath(Paths.Char),
            Desc: await this.buildIDsForPath(Paths.Desc),
        }
    }

    buildIDsForPath(p: PathInfo): Promise<string[]> {
        return new Promise((fulfill, reject) => {
            fs.readdir(path.join(this.rootPath, p.path), function(error, files) {
                if (error) {
                    if (error.code === "ENOENT") {
                        fulfill([]); // If the directory doesn't exist, then there are no IDs
                    }
                    else {
                        reject(error);
                    }
                }
                else {
                    fulfill(files.filter(function(name) {
                        return name.slice(name.length - (p.extension.length + 1), name.length) === ("." + p.extension);
                    }).map(function(name) {
                        return name.slice(0, name.length - (p.extension.length + 1));
                    }));
                }
            });
        });
    }
};

export { FilesystemData };
