import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.data.StringDataInstance;

public class ghidra_allstr extends GhidraScript {
    public void run() throws Exception {
        String sub = getScriptArgs().length > 0 ? getScriptArgs()[0] : "";
        Listing l = currentProgram.getListing();
        var it = l.getDefinedData(true);
        int n = 0;
        while (it.hasNext() && n < 5000) {
            var d = it.next();
            if (!"string".equals(d.getDataType().getName())) continue;
            String v = StringDataInstance.getStringDataInstance(d).getStringValue();
            if (v == null) continue;
            if (sub.isEmpty() || v.contains(sub)) {
                println("  " + d.getAddress() + " \"" + (v.length() > 110 ? v.substring(0, 110) : v) + "\"");
                n++;
            }
        }
        println("matched " + n);
    }
}
