import { getDefaultCharData } from "./CharData";
import { getDefaultCicnData } from "./CicnData";
import { getDefaultDescData } from "./DescData";
import { getDefaultDudeData } from "./DudeData";
import { getDefaultFleetData } from "./FleetData";
import { getDefaultGovernmentData } from "./GovernmentData";
import { getDefaultMissionData } from "./MissionData";
import { getDefaultCronData } from "./CronData";
import { getDefaultRankData } from "./RankData";
import { getDefaultJunkData } from "./JunkData";
import { getDefaultStringSetData } from "./StringSetData";
import { getDefaultCicnImageData } from "./CicnImage";
import { getDefaultSpriteSheetImage } from "./DefaultSpriteSheetImage";
import { getDefaultExplosionData } from "./ExplosionData";
import { getDefaultOutfitData } from "./OutiftData";
import { getDefaultPictData } from "./PictData";
import { getDefaultPictImageData } from "./PictImage";
import { getDefaultPersData } from "./PersData";
import { getDefaultPlanetData } from "./PlanetData";
import { getDefaultShipData } from "./ShipData";
import { getDefaultSoundFile } from "./SoundFile";
import { getDefaultSpriteSheetData, getDefaultSpriteSheetFrames } from "./SpriteSheetData";
import { getDefaultStatusBarData } from "./StatusBarData";
import { getDefaultSystemData } from "./SystemData";
import { getDefaultTargetCornersData } from "./TargetCornersData";
import { getDefaultProjectileWeaponData } from "./WeaponData";

// Should have one for every NovaDataType
export const Defaults = {
    get Ship() { return getDefaultShipData() },
    get Outfit() { return getDefaultOutfitData() },
    get Weapon() { return getDefaultProjectileWeaponData() },
    get Pict() { return getDefaultPictData() },
    get PictImage() { return getDefaultPictImageData() },
    get Cicn() { return getDefaultCicnData() },
    get CicnImage() { return getDefaultCicnImageData() },
    get Planet() { return getDefaultPlanetData() },
    get System() { return getDefaultSystemData() },
    get TargetCorners() { return getDefaultTargetCornersData() },
    get SpriteSheet() { return getDefaultSpriteSheetData() },
    get SpriteSheetImage() { return getDefaultSpriteSheetImage() },
    get SpriteSheetFrames() { return getDefaultSpriteSheetFrames() },
    get StatusBar() { return getDefaultStatusBarData() },
    get Explosion() { return getDefaultExplosionData() },
    get SoundFile() { return getDefaultSoundFile() },
    get Mission() { return getDefaultMissionData() },
    get Cron() { return getDefaultCronData() },
    get Government() { return getDefaultGovernmentData() },
    get Dude() { return getDefaultDudeData() },
    get Pers() { return getDefaultPersData() },
    get Fleet() { return getDefaultFleetData() },
    get Rank() { return getDefaultRankData() },
    get Junk() { return getDefaultJunkData() },
    get StringSet() { return getDefaultStringSetData() },
    get Char() { return getDefaultCharData() },
    get Desc() { return getDefaultDescData() },
}
