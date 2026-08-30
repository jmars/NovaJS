import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Reference;

public class ghidra_rand2 extends GhidraScript {
    public void run() throws Exception {
        FunctionManager fm = currentProgram.getFunctionManager();
        Address prng = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("004683b0");
        Reference[] refs = getReferencesTo(prng);
        java.util.TreeMap<String,Integer> counts = new java.util.TreeMap<>();
        for (Reference r : refs) {
            Function f = fm.getFunctionContaining(r.getFromAddress());
            String k = f == null ? "?" : (f.getName() + "@" + f.getEntryPoint());
            counts.merge(k, 1, Integer::sum);
        }
        for (var e : counts.entrySet()) println(String.format("%4d  %s", e.getValue(), e.getKey()));
        println("TOTAL sites: " + refs.length);
    }
}
