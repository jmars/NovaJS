import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Reference;
import java.util.*;

public class ghidra_globrefs extends GhidraScript {
    public void run() throws Exception {
        FunctionManager fm = currentProgram.getFunctionManager();
        for (String a : getScriptArgs()) {
            Address t = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(a);
            TreeMap<String, Integer> counts = new TreeMap<>();
            int total = 0;
            for (Reference r : getReferencesTo(t)) {
                Function f = fm.getFunctionContaining(r.getFromAddress());
                String k = f == null ? "?" : (f.getName() + "@" + f.getEntryPoint());
                counts.merge(k, 1, Integer::sum);
                total++;
            }
            println("=== refs to " + a + " total=" + total + " ===");
            for (var e : counts.entrySet()) println(String.format("  %4d  %s", e.getValue(), e.getKey()));
        }
    }
}
