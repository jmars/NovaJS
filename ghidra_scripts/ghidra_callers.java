import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;

public class ghidra_callers extends GhidraScript {
    public void run() throws Exception {
        for (String a : getScriptArgs()) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(a);
            Function f = currentProgram.getFunctionManager().getFunctionAt(addr);
            println("=== callers of " + (f != null ? f.getName() : a) + " @ " + a + " ===");
            Reference[] refs = getReferencesTo(addr);
            for (Reference r : refs) {
                if (r.getReferenceType().isCall()) {
                    Function cf = currentProgram.getFunctionManager().getFunctionContaining(r.getFromAddress());
                    println("  CALL from " + r.getFromAddress() + (cf != null ? " (" + cf.getName() + ")" : ""));
                }
            }
        }
    }
}
