import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.address.Address;

public class ghidra_rand extends GhidraScript {
    public void run() throws Exception {
        // EV Nova 1.0.10 uses a classic rand(): look for functions that call a PRNG.
        // Find calls to FUN_004683b0 (the jitter RNG seen in capture) and FUN_0046e790 etc.
        // Print the function names that contain a call to the suspected PRNG 004683b0.
        FunctionManager fm = currentProgram.getFunctionManager();
        Address prng = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("004683b0");
        Function pf = fm.getFunctionAt(prng);
        println("PRNG candidate FUN_004683b0: " + (pf != null ? pf.getName() : "?"));
        // list references TO it
        Reference[] refs = getReferencesTo(prng);
        int n=0;
        for (Reference r : refs) { if (n++<40) println("  called from " + r.getFromAddress()); }
    }
}
