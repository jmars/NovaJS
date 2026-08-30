import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;

public class ghidra_xref extends GhidraScript {
    public void run() throws Exception {
        DataIterator data = currentProgram.getListing().getDefinedData(true);
        while (data.hasNext()) {
            Data d = data.next();
            Object v = d.getValue();
            if (v instanceof String) {
                String s = (String) v;
                String low = s.toLowerCase();
                if (low.contains("commodity") || low.contains("tribble") || low.contains("perish")
                    || low.contains("junk type") || low.contains("price")
                    || low.contains("capture") || low.contains("board") || low.contains("crew")
                    || low.contains("marine") || low.contains("booty") || low.contains("plunder")
                    || low.contains("sell") || low.contains("shipyard") || low.contains("trade")
                    || low.contains("odds")) {
                    println("STR@" + d.getAddress() + " = " + s.trim());
                    Reference[] refs = getReferencesTo(d.getAddress());
                    for (Reference r : refs) {
                        println("   ref from " + r.getFromAddress());
                    }
                }
            }
        }
    }
}
