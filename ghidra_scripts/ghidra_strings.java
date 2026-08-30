import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;

public class ghidra_strings extends GhidraScript {
    public void run() throws Exception {
        DataIterator data = currentProgram.getListing().getDefinedData(true);
        while (data.hasNext()) {
            Data d = data.next();
            Object v = d.getValue();
            if (v instanceof String) {
                String s = (String) v;
                if (s.length() < 4) continue;
                StringBuilder sb = new StringBuilder();
                sb.append("STR@").append(d.getAddress()).append(" = ").append(s.replace('\n',' ').replace('\r',' ').trim());
                Reference[] refs = getReferencesTo(d.getAddress());
                for (Reference r : refs) {
                    sb.append(" | ref ").append(r.getFromAddress());
                }
                println(sb.toString());
            }
        }
    }
}
