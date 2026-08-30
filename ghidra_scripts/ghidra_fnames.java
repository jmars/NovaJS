import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;

public class ghidra_fnames extends GhidraScript {
    public void run() throws Exception {
        for (String a : getScriptArgs()) {
            Function f = currentProgram.getFunctionManager().getFunctionContaining(
                currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(a));
            println(a + " -> " + (f != null ? f.getName() + " @ " + f.getEntryPoint() : "?"));
        }
    }
}
