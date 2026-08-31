import { Animation, getDefaultAnimationImage, getDefaultExitPoints } from "novadatainterface/Animation";
import { BaseData } from "novadatainterface/BaseData";
import { NovaDataType } from "novadatainterface/NovaDataInterface";
import { getDefaultPictData } from "novadatainterface/PictData";
import { PlanetData } from "novadatainterface/PlanetData";
import { DamageType } from "novadatainterface/WeaponData";
import { BLEND_MODES } from "novadatainterface/BlendModes";
import { SpobResource } from "../resource_parsers/SpobResource";
import { BaseParse } from "./BaseParse";


// The standard-commodity price bands live in the high flag bytes, one
// nibble per commodity (Nova Bible spöb flags 2790-2813): commodity 0
// (Food) occupies bits 28-31, 1 (Industrial) 24-27, and so on down to
// 5 (Equipment) at bits 8-11. Within a nibble, bit 0x1 = low price,
// 0x2 = medium, 0x4 = high; no bit = the planet won't trade that
// commodity. Commodity c's nibble therefore sits at 28 - 4*c.
export function planetPriceBands(flags: number): number[] {
    const bands: number[] = [];
    for (var commodity = 0; commodity < 6; commodity++) {
        var nibble = (flags >>> (28 - 4 * commodity)) & 0xF;
        if (nibble & 0x4) {
            bands.push(3);
        }
        else if (nibble & 0x2) {
            bands.push(2);
        }
        else if (nibble & 0x1) {
            bands.push(1);
        }
        else {
            bands.push(0);
        }
    }
    return bands;
}


export async function PlanetParse(spob: SpobResource, notFoundFunction: (m: string) => void): Promise<PlanetData> {
    var base: BaseData = await BaseParse(spob, notFoundFunction);

    const defaultPictData = getDefaultPictData();
    const defaultAnimationImage = getDefaultAnimationImage();

    var desc: string;
    var descResource = spob.idSpace.dësc[spob.landingDescID];
    if (descResource) {
        desc = descResource.text;
    }
    else {
        desc = "No matching dësc for spöb of id " + base.id;
        notFoundFunction(desc);
    }

    var pictID: string;
    var pict = spob.idSpace.PICT[spob.landingPictID]
    if (pict) {
        pictID = pict.globalID;
    }
    else {
        notFoundFunction("No matching PICT for spöb of id " + base.id);
        pictID = defaultPictData.id;
    }

    var rledResource = spob.idSpace.rlëD[spob.graphic];
    var rledID: string;
    if (rledResource) {
        rledID = rledResource.globalID;
    }
    else {
        notFoundFunction("No matching rlëd id " + spob.graphic + " for spöb of id " + base.id);
        rledID = defaultAnimationImage.id;
    }

    // FUN_00462410: the spöb radius is the FULL WIDTH of the sprite base
    // frame (FUN_00462390 returns the frame-rect right−left = rlëD size[0]),
    // not a half-size; the trader travel arrival test is radius/4. Engine
    // default 0x96 = 150 when the sprite is missing.
    var radius = 150;
    if (rledResource) {
        radius = rledResource.size[0];
    }

    const animation: Animation = {
        exitPoints: getDefaultExitPoints(),
        id: base.id,
        name: base.name,
        prefix: base.prefix,
        images: {
            baseImage: {
                id: rledID,
                dataType: NovaDataType.SpriteSheetImage,
                blendMode: BLEND_MODES.NORMAL,
                frames: {
                    normal: { start: 0, length: 1 }
                }
            }

        }
    };

    var govt: string | null = null;
    if (spob.government > 0) {
        var govtResource = spob.idSpace.gövt[spob.government];
        if (govtResource) {
            govt = govtResource.globalID;
        }
        else {
            notFoundFunction("No matching gövt id " + spob.government + " for spöb of id " + base.id);
        }
    }

    return {
        ...base,
        landingDesc: desc,
        landingPict: pictID,
        animation,
        vulnerableTo: <Array<DamageType>>["planetBuster"],
        physics: {
            shield: 1000,
            shieldRecharge: 1000,
            armor: 1000,
            armorRecharge: 1000,
            acceleration: 0,
            speed: 0,
            deionize: 0,
            energy: 0,
            energyRecharge: 0,
            ionization: 0,
            mass: 0,
            turnRate: 0,
            inertialess: true,
        },
        position: [spob.position[0], spob.position[1]],
        govt,
        radius,
        inhabited: (spob.flags & 0x20) === 0,
        flags2: spob.flags2,
        hasBar: (spob.flags & 0x40) !== 0,
        tech: spob.techLevel,
        hasTradeCenter: (spob.flags & 0x00000002) !== 0,
        hasOutfitter: (spob.flags & 0x00000004) !== 0,
        hasShipyard: (spob.flags & 0x00000008) !== 0,
        priceBands: planetPriceBands(spob.flags)
    }
}
