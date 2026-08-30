import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

public class ghidra_fn extends GhidraScript {
    public void run() throws Exception {
        for (String a : getScriptArgs()) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(a);
            Function f = getFunctionContaining(addr);
            println(a + " -> " + (f == null ? "NO FN" : f.getName() + " @ " + f.getEntryPoint() + " body " + f.getBody()));
        }
    }
}
