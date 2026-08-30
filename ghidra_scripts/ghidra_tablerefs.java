import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Listing;

public class ghidra_tablerefs extends GhidraScript {
    public void run() throws Exception {
        Listing l = currentProgram.getListing();
        Address p = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("00591290");
        for (int i = 0; i < 0x400; i += 4) {
            Data d = l.getDataAt(p.add(i));
            if (d == null) continue;
            Object v = d.getValue();
            if (v instanceof Address) println("  " + d.getAddress() + " " + d.getDataType().getName() + " -> " + v);
            else if (v != null) println("  " + d.getAddress() + " " + d.getDataType().getName() + " = " + v);
        }
    }
}
