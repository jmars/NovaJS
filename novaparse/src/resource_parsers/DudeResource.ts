import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";

// Reads a düde (ship class group) resource: 88 bytes.
// Note: stock data stores a single combined cargo/"can't be hit" word (Booty);
// the Bits field documented in the Nova Bible shares those bit values, so the
// raw word is exposed as both booty and flags.

class DudeResource extends BaseResource {
    aiType: number;
    govt: number;
    booty: number;
    infoTypes: number;
    shipTypes: Array<number>;
    probabilities: Array<number>;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.aiType = d.getInt16(0x00);
        this.govt = d.getInt16(0x02);
        this.booty = d.getInt16(0x04);
        this.infoTypes = d.getInt16(0x06);

        this.shipTypes = [];
        this.probabilities = [];
        for (var i = 0; i < 16; i += 1) {
            this.shipTypes.push(d.getInt16(0x08 + i * 2));
            this.probabilities.push(d.getInt16(0x28 + i * 2));
        }
    }

    get flags(): number {
        return this.booty;
    }
}

export { DudeResource }
