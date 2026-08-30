import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.symbol.Reference;

public class ghidra_xref2 extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        FunctionManager fm = currentProgram.getFunctionManager();
        for (String a : args) {
            Address t = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(a);
            println("=== refs to " + a + " ===");
            for (Reference r : getReferencesTo(t)) {
                Function f = fm.getFunctionContaining(r.getFromAddress());
                println("  from " + r.getFromAddress() + " in " + (f == null ? "?" : f.getName() + "@" + f.getEntryPoint()));
            }
        }
    }
}
