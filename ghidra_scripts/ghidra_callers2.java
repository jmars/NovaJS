import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;

public class ghidra_callers2 extends GhidraScript {
    public void run() throws Exception {
        for (String t : getScriptArgs()) {
            Address a = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(t);
            FunctionManager fm = currentProgram.getFunctionManager();
            Function f = fm.getFunctionContaining(a);
            println("=== callers of " + (f==null?t:f.getName()) + " @" + a + " ===");
            for (Reference r : getReferencesTo(a)) {
                Function c = fm.getFunctionContaining(r.getFromAddress());
                println("  from " + r.getFromAddress() + (c==null?"":(" " + c.getName() + "@" + c.getEntryPoint())));
            }
        }
    }
}
