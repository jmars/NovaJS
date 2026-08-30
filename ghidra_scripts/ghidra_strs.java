import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.symbol.Reference;

public class ghidra_strs extends GhidraScript {
    public void run() throws Exception {
        String[] keys = getScriptArgs();
        DataIterator data = currentProgram.getListing().getDefinedData(true);
        while (data.hasNext()) {
            Data d = data.next();
            Object v = d.getValue();
            if (v instanceof String) {
                String s = ((String) v).trim();
                String low = s.toLowerCase();
                for (String k : keys) {
                    if (low.contains(k)) {
                        println("STR@" + d.getAddress() + " len=" + s.length() + " = " + s.substring(0, Math.min(80, s.length())));
                        for (Reference r : getReferencesTo(d.getAddress())) {
                            println("   ref from " + r.getFromAddress());
                        }
                        break;
                    }
                }
            }
        }
    }
}
