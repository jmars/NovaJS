import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.symbol.Reference;

public class ghidra_spawnstr extends GhidraScript {
    public void run() throws Exception {
        DataIterator data = currentProgram.getListing().getDefinedData(true);
        while (data.hasNext()) {
            Data d = data.next();
            Object v = d.getValue();
            if (v instanceof String) {
                String s = ((String)v).toLowerCase();
                if (s.contains("fleet") || s.contains("spawn") || s.contains("arriv") ||
                    s.contains("jump in") || s.contains("hyper") || s.contains("warp")) {
                    println("STR@" + d.getAddress() + " = " + v.toString().trim().substring(0, Math.min(60, ((String)v).trim().length())));
                    Reference[] refs = getReferencesTo(d.getAddress());
                    for (Reference r : refs) println("   ref from " + r.getFromAddress());
                }
            }
        }
    }
}
