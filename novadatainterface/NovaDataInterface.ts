import { CharData } from "./CharData";
import { CronData } from "./CronData";
import { CicnData } from "./CicnData";
import { DescData } from "./DescData";
import { DudeData } from "./DudeData";
import { FleetData } from "./FleetData";
import { GovernmentData } from "./GovernmentData";
import { JunkData } from "./JunkData";
import { MissionData } from "./MissionData";
import { RankData } from "./RankData";
import { StringSetData } from "./StringSetData";
import { CicnImageData } from "./CicnImage";
import { ExplosionData } from "./ExplosionData";
import { Gettable } from "./Gettable";
import { OutfitData } from "./OutiftData";
import { PictData } from "./PictData";
import { PictImageData } from "./PictImage";
import { PersData } from "./PersData";
import { PlanetData } from "./PlanetData";
import { ShipData } from "./ShipData";
import { SoundFile } from "./SoundFile";
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from "./SpriteSheetData";
import { StatusBarData } from "./StatusBarData";
import { SystemData } from "./SystemData";
import { TargetCornersData } from "./TargetCornersData";
import { WeaponData } from "./WeaponData";


enum NovaDataType {
    Ship = "Ship",
    Outfit = "Outfit",
    Weapon = "Weapon",
    Pict = "Pict",
    PictImage = "PictImage",
    Cicn = "Cicn",
    CicnImage = "CicnImage",
    Planet = "Planet",
    System = "System",
    TargetCorners = "TargetCorners",
    SpriteSheet = "SpriteSheet",
    SpriteSheetImage = "SpriteSheetImage",
    SpriteSheetFrames = "SpriteSheetFrames",
    StatusBar = "StatusBar",
    Explosion = "Explosion",
    SoundFile = "SoundFile",
    Mission = "Mission",
    Cron = "Cron",
    Government = "Government",
    Dude = "Dude",
    Pers = "Pers",
    Fleet = "Fleet",
    Rank = "Rank",
    Junk = "Junk",
    StringSet = "StringSet",
    Char = "Char",
    Desc = "Desc",
};

// index: NovaDataType
type NovaDataInterface = {
    Ship: Gettable<ShipData>,
    Outfit: Gettable<OutfitData>,
    Weapon: Gettable<WeaponData>,
    Pict: Gettable<PictData>,
    PictImage: Gettable<PictImageData>,
    Cicn: Gettable<CicnData>,
    CicnImage: Gettable<CicnImageData>,
    Planet: Gettable<PlanetData>,
    System: Gettable<SystemData>,
    TargetCorners: Gettable<TargetCornersData>,
    SpriteSheet: Gettable<SpriteSheetData>,
    SpriteSheetImage: Gettable<SpriteSheetImageData>,
    SpriteSheetFrames: Gettable<SpriteSheetFramesData>,
    StatusBar: Gettable<StatusBarData>,
    Explosion: Gettable<ExplosionData>,
    SoundFile: Gettable<SoundFile>,
    Mission: Gettable<MissionData>,
    Cron: Gettable<CronData>,
    Government: Gettable<GovernmentData>,
    Dude: Gettable<DudeData>,
    Pers: Gettable<PersData>,
    Fleet: Gettable<FleetData>,
    Rank: Gettable<RankData>,
    Junk: Gettable<JunkData>,
    StringSet: Gettable<StringSetData>,
    Char: Gettable<CharData>,
    Desc: Gettable<DescData>,
}

class NovaIDNotFoundError extends Error { };

export { NovaDataInterface, NovaDataType, NovaIDNotFoundError };
